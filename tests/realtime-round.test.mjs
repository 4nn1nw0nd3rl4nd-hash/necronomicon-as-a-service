import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { resolve, dirname } from 'node:path'
const require = createRequire(`${process.cwd()}/package.json`)
const ts = require('typescript')
// Hook lifecycle simulation; no live backend or browser is used.
let harnessId = 0
function harness(supabase, globals = {}, overrides = {}) {
  const instanceId = ++harnessId
  const modules = new Map()
  let cursor = 0, args, renderHook, stateWrites = 0
  const slots = [], pendingEffects = []
  const same = (a,b) => a && b && a.length === b.length && a.every((v,i) => Object.is(v,b[i]))
  const react = {
    useState(initial) {
      const i = cursor++
      if (!slots[i]) slots[i] = {
        value: typeof initial === 'function' ? initial() : initial,
        set: value => { stateWrites++; slots[i].value = typeof value === 'function' ? value(slots[i].value) : value },
      }
      return [slots[i].value, slots[i].set]
    },
    useRef(initial) { const i=cursor++; return slots[i] ??= { current: initial } },
    useId() { return react.useRef(`test-${instanceId}-${cursor}`).current },
    useCallback(callback,deps) {
      const i=cursor++
      if (!slots[i] || !same(slots[i].deps,deps)) slots[i] = { deps, callback }
      return slots[i].callback
    },
    useEffectEvent(callback) {
      const ref=react.useRef(callback); ref.current=callback
      return react.useCallback((...a)=>ref.current(...a),[])
    },
    useEffect(effect,deps) {
      const i=cursor++, previous=slots[i]
      if (!previous || !same(previous.deps,deps)) {
        slots[i]={ deps, effect, cleanup: previous?.cleanup }
        pendingEffects.push(i)
      }
    },
  }
  function load(file) {
    file = resolve(file)
    if (modules.has(file)) return modules.get(file)
    const source = ts.transpileModule(readFileSync(file,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX }}).outputText
    const exports={}
    vm.runInNewContext(source, { exports, AbortController, setTimeout, clearTimeout, ...globals, require: name => {
      if (overrides[name]) return { __esModule: true, ...overrides[name] }
      if (name === 'react/jsx-runtime') return { jsx: (type, props, key) => ({type, props, key}), jsxs: (type, props, key) => ({type, props, key}) }
      if (name === 'react') return react
      if (name === '../lib/supabase') return { supabase }
      if (name.startsWith('.')) return load(resolve(dirname(file), `${name}.ts`))
      throw Error(name)
    }})
    modules.set(file, exports)
    return exports
  }
  return {
    load,
    stateWriteCount: () => stateWrites,
    render(fn=renderHook,next=args) {
      renderHook=fn; args=next; cursor=0
      const result=fn(...next)
      const effects=pendingEffects.splice(0)
      for (const i of effects) slots[i].cleanup?.()
      for (const i of effects) slots[i].cleanup=slots[i].effect()
      return result
    },
    cleanup() { for (const slot of slots) slot?.cleanup?.() },
    replayEffects() {
      this.cleanup()
      for (const slot of slots) if (slot?.effect) slot.cleanup=slot.effect()
    },
  }
}
function backend() {
  const requests=[], channels=[], removals=[]
  const api={
    rpc(name,args) {
      return new Promise((resolve,reject)=>requests.push({rpc:name,args,resolve,reject}))
    },
    from(table) {
      const query={ table }
      let resolve,reject
      const promise=new Promise((yes,no)=>{resolve=yes;reject=no})
      const chain={
        update(values){query.values=values;return chain},
        select(fields){ query.fields=fields; return chain },
        eq(key,value){query[key]=value;return chain},
        order(){return chain},
        is(key,value){query[key]=value;return chain},
        not(key,operator,value){query[key]={operator,value};return chain},
        maybeSingle(){query.single=true;return chain},
        abortSignal(signal){query.signal=signal;return chain},
        overrideTypes(){requests.push({...query,resolve,reject});return promise},
      }
      return chain
    },
    channel(name) {
      // Match SDK topic reuse while removeChannel is still unresolved.
      const existing=channels.find(c=>c.name===name)
      if(existing) return existing
      const c={name, bindings:[], on(kind,config,cb){c.bindings.push({kind,config,cb});Object.assign(c,{kind,config,cb});return c},subscribe(status){c.status=status;return c}}
      channels.push(c);return c
    },
    removeChannel(c){removals.push(c);return new Promise(()=>{})},
  }
  return {api,requests,channels,removals}
}
const round='11111111-1111-4111-8111-111111111111'
const other='22222222-2222-4222-8222-222222222222'
const user='player'
const tick=async()=>{await Promise.resolve();await Promise.resolve()}
const row=active=>[{id:'membership',user_id:user,round_id:round,role:'player',active_character_id:active}]
function membersSetup() {
  const b=backend(), h=harness(b.api), {useRoundMembers:hook}=h.load('src/hooks/useRoundMembers.ts')
  h.render(hook,[round,user])
  return {b,h,hook}
}
test('initial load, silent refetch, burst coalescing, trailing events, server data only', async()=>{
  const {b,h}=membersSetup()
  assert.equal(b.requests.length,1)
  assert.equal(h.render().isLoading,true)
  b.requests[0].resolve({data:row('A'),error:null});await tick()
  const initial=h.render()
  assert.equal(initial.members[0].active_character_id,'A')
  for(let i=0;i<25;i++) initial.reload()
  assert.equal(b.requests.length,2)
  assert.equal(h.render().members,initial.members)
  assert.equal(h.render().isLoading,false)
  b.requests[1].resolve({data:row('B'),error:null});await tick()
  assert.equal(b.requests.length,3)
  assert.equal(h.render().members[0].active_character_id,'B')
  h.render().reload()
  b.requests[2].resolve({data:row('C'),error:null});await tick()
  assert.equal(b.requests.length,4)
  b.requests[3].resolve({data:row('D'),error:null});await tick()
  assert.equal(h.render().members[0].active_character_id,'D')
  assert.equal(b.requests.length,4)
})
test('background errors retain last good data, pending refresh survives errors, manual retry works',async()=>{
  const {b,h}=membersSetup()
  b.requests[0].resolve({data:row('A'),error:null});await tick()
  const old=h.render().members
  h.render().reload();h.render().reload()
  b.requests[1].reject(Error('network'));await tick()
  assert.equal(h.render().members,old)
  assert.equal(h.render().error,null)
  assert.equal(b.requests.length,3)
  b.requests[2].resolve({data:null,error:{message:'offline'}});await tick()
  assert.equal(h.render().members,old)
  h.render().reload()
  b.requests[3].resolve({data:[],error:null});await tick()
  assert.equal(h.render().members.length,0)
  assert.equal(h.render().isLoading,false)
})
test('initial failure reports error and retries normally',async()=>{
  const {b,h}=membersSetup()
  b.requests[0].resolve({data:null,error:{message:'offline'}});await tick()
  assert.ok(h.render().error)
  h.render().reload();assert.equal(h.render().isLoading,true)
  b.requests[1].resolve({data:row('A'),error:null});await tick()
  assert.equal(h.render().error,null)
})
test('round/account changes and logout reject stale responses and abort old requests',async()=>{
  const {b,h,hook}=membersSetup()
  h.render(hook,[other,user]);assert.equal(b.requests[0].signal.aborted,true)
  b.requests[1].resolve({data:row('new-round'),error:null});await tick()
  b.requests[0].resolve({data:row('old-round'),error:null});await tick()
  assert.equal(h.render().members[0].active_character_id,'new-round')
  h.render(hook,[other,'other-user']);assert.equal(h.render().members.length,0)
  h.render(hook,[other,undefined]);assert.equal(b.requests[2].signal.aborted,true)
  b.requests[2].resolve({data:row('old-user'),error:null});await tick()
  assert.equal(h.render().members.length,0)
  h.render().reload();assert.equal(b.requests.length,3)
  h.render(hook,['invalid',user]);assert.equal(b.requests.length,3)
})
test('StrictMode effect replay aborts first load and ignores its eventual response',async()=>{
  const {b,h}=membersSetup();h.replayEffects()
  assert.equal(b.requests[0].signal.aborted,true)
  b.requests[1].resolve({data:row('current'),error:null});await tick()
  b.requests[0].resolve({data:row('obsolete'),error:null});await tick()
  assert.equal(h.render().members[0].active_character_id,'current')
  h.cleanup();assert.equal(b.requests[1].signal.aborted,true)
})
test('channel filter, latest callback, no rerender duplicates, reconnect, scope/logout cleanup',()=>{
  const b=backend(),h=harness(b.api),{useRealtimeInvalidation:hook}=h.load('src/hooks/useRealtimeInvalidation.ts')
  let count=0
  const options={scopeKey:`${user}:${round}`,table:'round_memberships',filter:`round_id=eq.${round}`,onInvalidate:()=>count++}
  h.render(hook,[options]);const c=b.channels[0]
  assert.equal(c.kind,'postgres_changes');assert.equal(c.config.event,'UPDATE')
  assert.equal(c.config.schema,'public');assert.equal(c.config.table,'round_memberships')
  assert.equal(c.config.filter,`round_id=eq.${round}`)
  h.render(hook,[{...options,onInvalidate:()=>count+=10}]);assert.equal(b.channels.length,1)
  c.cb({new:{active_character_id:'payload-is-not-data'}});assert.equal(count,10)
  c.status('CHANNEL_ERROR');assert.equal(count,10)
  c.status('SUBSCRIBED');c.status('SUBSCRIBED');assert.equal(count,30)
  h.replayEffects();assert.equal(b.removals[0],c)
  assert.equal(b.channels.length,2);assert.notEqual(b.channels[1].name,c.name)
  c.cb();c.status('SUBSCRIBED');assert.equal(count,30)
  b.channels[1].cb();assert.equal(count,40)
  h.render(hook,[{...options,scopeKey:`${user}:${other}`,filter:`round_id=eq.${other}`}])
  assert.equal(b.removals.length,2);assert.equal(b.channels.length,3)
  h.render(hook,[{...options,scopeKey:undefined}]);assert.equal(b.removals.length,3)
  b.channels[2].cb();assert.equal(count,40)
  h.render(hook,[options]);assert.equal(b.channels.length,4)
  h.cleanup();assert.equal(b.removals.length,4)
})
test('UPDATE invalidates and fetches canonical SELECT data instead of patching payload',async()=>{
  const {b,h}=membersSetup()
  b.requests[0].resolve({data:row('A'),error:null});await tick()
  const rt=harness(b.api),{useRealtimeInvalidation:hook}=rt.load('src/hooks/useRealtimeInvalidation.ts')
  rt.render(hook,[{scopeKey:round,table:'round_memberships',filter:`round_id=eq.${round}`,onInvalidate:h.render().reload}])
  b.channels[0].cb({new:{active_character_id:'untrusted-payload'}})
  assert.equal(h.render().members[0].active_character_id,'A')
  assert.equal(b.requests[1].table,'round_memberships');assert.equal(b.requests[1].round_id,round)
  b.requests[1].resolve({data:row('server-B'),error:null});await tick()
  assert.equal(h.render().members[0].active_character_id,'server-B')
  rt.cleanup();h.cleanup()
})

function browserClock() {
  let time=0, next=0
  const timers=new Map()
  const window=new EventTarget(), document=new EventTarget()
  document.visibilityState='visible'
  return {
    window, document,
    setTimeout(fn,delay){const id=++next;timers.set(id,{at:time+delay,fn});return id},
    clearTimeout(id){timers.delete(id)},
    advance(ms=100){
      time+=ms
      for(const [id,t] of [...timers]) if(t.at<=time){timers.delete(id);t.fn()}
    },
    pending(){return timers.size},
  }
}
const roundData=(role='game_master',overrides={})=>({round_id:round,role,round:{
  id:round,name:'Test-Runde',description:'Beschreibung',system:null,appointment:null,
  status:'active',locked_at:null,locked_reason:null,orphaned_at:null,...overrides,
}})
const member=(id=user,role='player')=>({
  id:`member-${id}`,round_id:round,user_id:id,role,active_character_id:'A',created_at:'2026-09-01',
  profile:{id,username:id,display_name:id,is_superadmin:false,deletion_pending_at:null},
})
const character=(id='A',owner=user)=>({
  id,name:id,owner_user_id:owner,round_id:round,template_key:'test',template_version:1,
  updated_at:'2026-09-11T00:00:00Z',deleted_at:null,
})

test('round details preserves data on network errors, adopts metadata/role, clears missing access',async()=>{
  const b=backend(),h=harness(b.api),{useRoundDetails:hook}=h.load('src/hooks/useRoundDetails.ts')
  h.render(hook,[round,user]);b.requests[0].resolve({data:roundData(),error:null});await tick()
  const initial=h.render().round
  h.render().reload();assert.equal(h.render().round,initial);assert.equal(h.render().isLoading,false)
  b.requests[1].resolve({data:null,error:{code:'network'}});await tick()
  assert.equal(h.render().round,initial)
  h.render().reload();b.requests[2].resolve({data:roundData('player',{status:'archived',orphaned_at:'2026-09-11'}),error:null});await tick()
  assert.equal(h.render().membershipRole,'player');assert.equal(h.render().round.status,'archived')
  assert.equal(h.render().round.orphaned_at,'2026-09-11')
  h.render().reload();b.requests[3].resolve({data:null,error:null});await tick()
  assert.equal(h.render().round,null);assert.equal(h.render().membershipRole,null);assert.ok(h.render().error)
  // Re-authorized data can arrive through focus/reconnect without navigating away.
  h.render().reload();b.requests[4].resolve({data:roundData(),error:null});await tick()
  assert.ok(h.render().round)
  h.render().reload();b.requests[5].resolve({data:null,error:{code:'42501'}});await tick()
  assert.equal(h.render().round,null)
})

for(const [file,key,good,args] of [
  ['useRoundDetails','round',roundData(),[round,user]],
  ['useRoundCharacters','characters',[character()],[round,`${user}:game_master`]],
  ['useRoundDeletedPreparedCharacters','characters',[{...character('prepared',null),deleted_at:'2026-09-11'}],[round,`${user}:game_master`]],
]) {
  test(`${file}: silent refresh, one trailing fetch, stale scopes and permission errors`,async()=>{
    const b=backend(),h=harness(b.api),hook=h.load(`src/hooks/${file}.ts`)[file]
    h.render(hook,args);b.requests[0].resolve({data:good,error:null});await tick()
    const before=h.render()[key]
    for(let i=0;i<10;i++)h.render().reload()
    assert.equal(b.requests.length,2);assert.equal(h.render()[key],before);assert.equal(h.render().isLoading,false)
    b.requests[1].resolve({data:good,error:null});await tick();assert.equal(b.requests.length,3)
    b.requests[2].reject(Error('offline'));await tick();assert.equal(h.render().error,null)
    h.render().reload();h.render(hook,[other,args[1]])
    assert.equal(b.requests[3].signal.aborted,true)
    b.requests[4].resolve({data:good,error:null});await tick()
    b.requests[3].resolve({data:null,error:{code:'42501'}});await tick()
    assert.ok(h.render()[key]);assert.equal(h.render().error,null)
    h.render().reload();b.requests[5].resolve({data:null,error:{code:'42501'}});await tick()
    assert.ok(h.render().error)
    assert.equal(key==='round'?h.render().round:h.render().characters.length,key==='round'?null:0)
    h.cleanup()
  })
}

test('character access scope changes hide old GM data immediately, trash disables on role loss',async()=>{
  for(const name of ['useRoundCharacters','useRoundDeletedPreparedCharacters']) {
    const b=backend(),h=harness(b.api),hook=h.load(`src/hooks/${name}.ts`)[name]
    h.render(hook,[round,'user:game_master']);b.requests[0].resolve({data:[character('secret',null)],error:null});await tick()
    assert.equal(h.render().characters.length,1)
    h.render(hook,[round,'user:player']);assert.equal(h.render().characters.length,0)
    b.requests[1].reject(Error('offline'));await tick();assert.equal(h.render().characters.length,0)
    h.render(hook,[undefined,'user:player']);assert.equal(h.render().characters.length,0)
    h.render().reload();assert.equal(b.requests.length,2)
  }
})

function coordinatorSetup() {
  const b=backend(),clock=browserClock(),h=harness(b.api,clock)
  const {useRoundRealtime:hook}=h.load('src/hooks/useRoundRealtime.ts')
  const calls={round:0,members:0,characters:0,trash:0}
  const options={roundId:round,userId:user,...Object.fromEntries(Object.keys(calls).map(k=>[
    `reload${k[0].toUpperCase()+k.slice(1)}`,()=>calls[k]++,
  ]))}
  h.render(hook,[options])
  const emit=(table,event)=>{
    const channel=b.channels.find(c=>c.config.table===table)
    const binding=channel.bindings.find(b=>b.config.event===event)
    assert.ok(binding,`${table} ${event}`);binding.cb()
  }
  return {b,h,clock,calls,options,hook,emit}
}
test('exact table/event scopes and targeted invalidations, RPC bursts are coalesced',()=>{
  const {b,h,clock,calls,emit}=coordinatorSetup()
  assert.equal(b.channels.length,3)
  for(const c of b.channels) for(const binding of c.bindings){
    assert.equal(binding.config.schema,'public')
    assert.equal(binding.config.filter,c.config.table==='rounds'?`id=eq.${round}`:`round_id=eq.${round}`)
    assert.ok(['INSERT','UPDATE'].includes(binding.config.event))
  }
  assert.equal(b.channels.find(c=>c.config.table==='rounds').bindings.length,1)
  emit('rounds','UPDATE');clock.advance();assert.deepEqual(calls,{round:1,members:1,characters:1,trash:1})
  for(const event of ['INSERT','UPDATE']) {
    emit('round_memberships',event);clock.advance()
  }
  assert.deepEqual(calls,{round:3,members:3,characters:3,trash:3})
  for(const event of ['INSERT','UPDATE']) {emit('characters',event);clock.advance()}
  assert.deepEqual(calls,{round:3,members:5,characters:5,trash:5})
  for(let i=0;i<30;i++){emit('characters','UPDATE');emit('round_memberships','UPDATE')}
  assert.equal(clock.pending(),1);clock.advance()
  assert.deepEqual(calls,{round:4,members:6,characters:6,trash:6})
  h.render();assert.equal(b.channels.length,3)
  h.cleanup()
})
test('focus/visible/online/reconnect reconcile once, hidden events and invalid scopes do nothing',()=>{
  const {b,h,clock,calls,options,hook}=coordinatorSetup()
  clock.document.visibilityState='hidden'
  clock.document.dispatchEvent(new Event('visibilitychange'))
  clock.window.dispatchEvent(new Event('focus'));clock.advance()
  assert.equal(calls.round,0)
  clock.document.visibilityState='visible'
  clock.document.dispatchEvent(new Event('visibilitychange'));clock.window.dispatchEvent(new Event('focus'))
  assert.equal(clock.pending(),1);clock.advance()
  assert.deepEqual(calls,{round:1,members:1,characters:1,trash:1})
  for(const c of b.channels)c.status('SUBSCRIBED')
  clock.window.dispatchEvent(new Event('online'));clock.advance()
  assert.deepEqual(calls,{round:2,members:2,characters:2,trash:2})
  // Pending old-scope work and listeners must disappear on navigation/logout.
  clock.window.dispatchEvent(new Event('focus'))
  h.render(hook,[{...options,roundId:other}]);clock.advance();assert.equal(calls.round,2)
  assert.equal(b.removals.length,3);assert.equal(b.channels.length,6)
  h.render(hook,[{...options,userId:undefined}]);clock.window.dispatchEvent(new Event('focus'));clock.advance()
  assert.equal(calls.round,2);assert.equal(b.removals.length,6)
  h.render(hook,[{...options,roundId:'invalid'}]);assert.equal(b.channels.length,6)
  h.cleanup()
})
test('coordinator StrictMode replay tears down all old channels and cancels pending timers',()=>{
  const {b,h,clock,calls,emit}=coordinatorSetup()
  emit('round_memberships','UPDATE');h.replayEffects();clock.advance()
  assert.equal(calls.round,0);assert.equal(b.channels.length,6);assert.equal(b.removals.length,3)
  for(const c of b.channels.slice(0,3)){c.cb();c.status('SUBSCRIBED')}
  clock.advance();assert.equal(calls.round,0)
  for(const c of b.channels.slice(3))c.status('SUBSCRIBED')
  clock.advance();assert.equal(calls.round,1)
  h.cleanup();assert.equal(b.removals.length,6)
})

function nodes(tree) {
  if(Array.isArray(tree))return tree.flatMap(nodes)
  if(!tree || typeof tree!=='object')return []
  return [tree,...nodes(tree.props?.children)]
}
function textOf(tree) {
  if(Array.isArray(tree))return tree.map(textOf).join('')
  if(tree==null || typeof tree==='boolean')return ''
  if(typeof tree!=='object')return String(tree)
  return textOf(tree.props?.children)
}
test('page keeps character-section identity across membership changes, removes UI on access loss',async()=>{
  const b=backend(),clock=browserClock()
  const h=harness(b.api,clock,{
    'react-router-dom':{useParams:()=>({roundId:round}),Link:'Link'},
    '../auth/useAuth':{useAuth:()=>({user:{id:user}})},
    '../components/AddRoundMemberSearch':{default:'AddRoundMemberSearch'},
    '../components/EditRoundForm':{default:'EditRoundForm'},
    '../components/RoundCharactersSection':{default:'RoundCharactersSection'},
    '../hooks/useRemoveRoundPlayer':{useRemoveRoundPlayer:()=>({})},
    '../hooks/useTransferGameMaster':{useTransferGameMaster:()=>({})},
  })
  const Page=h.load('src/pages/RoundDetailsPage.tsx').default
  h.render(Page,[])
  b.requests[0].resolve({data:roundData(),error:null})
  b.requests[1].resolve({data:[member(user,'game_master')],error:null});await tick()
  const first=nodes(h.render()).find(n=>n.type==='RoundCharactersSection')
  assert.ok(first);const key=first.key
  b.requests[2].resolve({data:[character()],error:null});b.requests[3].resolve({data:[],error:null});await tick()
  const c=b.channels.find(c=>c.config.table==='round_memberships');c.cb();clock.advance()
  b.requests[4].resolve({data:roundData(),error:null})
  b.requests[5].resolve({data:[member('new'),member(user,'game_master')],error:null})
  b.requests[6].resolve({data:[character()],error:null});b.requests[7].resolve({data:[],error:null});await tick()
  assert.equal(nodes(h.render()).find(n=>n.type==='RoundCharactersSection').key,key)
  c.cb();clock.advance()
  // Successful empty memberships must hide data even if the details request fails.
  b.requests[8].reject(Error('network'));b.requests[9].resolve({data:[],error:null});await tick()
  const denied=h.render();assert.ok(!nodes(denied).some(n=>n.type==='RoundCharactersSection'))
  assert.ok(!nodes(denied).some(n=>n.type==='AddRoundMemberSearch'))
  assert.match(textOf(denied),/nicht verfügbar/)
  assert.equal(b.requests[10].signal.aborted,true);assert.equal(b.requests[11].signal.aborted,true)
  h.cleanup()
})
test('opened assignment retains selected player across new list props; removed selection cannot continue',()=>{
  const b=backend(),h=harness(b.api,{}, {
    'react-router-dom':{Link:'Link',useSearchParams:()=>[new URLSearchParams(),()=>{}]},
    '../characterTemplates':{findCharacterTemplate:()=>({name:'Test'})},
  })
  const Section=h.load('src/components/RoundCharactersSection.tsx').default
  const list={characters:[character('prepared',null)],isLoading:false,error:null,reload(){}}
  const props={roundId:round,roundStatus:'active',isRoundLocked:false,membershipRole:'game_master',
    currentUserId:'gm',members:[member()],onMembershipsReload(){},characterList:list,
    characterTrash:{...list,characters:[]},
  }
  let tree=h.render(Section,[props])
  nodes(tree).find(n=>n.type==='button'&&textOf(n)==='Spieler zuweisen').props.onClick()
  tree=h.render();nodes(tree).find(n=>n.type==='select').props.onChange({target:{value:user}})
  tree=h.render(Section,[{...props,characterList:{...list,characters:[{...character('prepared',null),name:'Neuer Name'}]},members:[{...member(),active_character_id:'B'}]}])
  assert.equal(nodes(tree).find(n=>n.type==='select').props.value,user)
  assert.equal(nodes(tree).find(n=>n.type==='button'&&textOf(n)==='Weiter').props.disabled,false)
  tree=h.render(Section,[{...props,members:[member('other')]}])
  assert.equal(nodes(tree).find(n=>n.type==='select').props.value,'')
  assert.equal(nodes(tree).find(n=>n.type==='button'&&textOf(n)==='Weiter').props.disabled,true)
  h.cleanup()
})

test('server GM-role change updates page actions and replaces the character permission scope',async()=>{
  const b=backend(),clock=browserClock(),h=harness(b.api,clock,{
    'react-router-dom':{useParams:()=>({roundId:round}),Link:'Link'},
    '../auth/useAuth':{useAuth:()=>({user:{id:user}})},
    '../components/AddRoundMemberSearch':{default:'AddRoundMemberSearch'},
    '../components/EditRoundForm':{default:'EditRoundForm'},
    '../components/RoundCharactersSection':{default:'RoundCharactersSection'},
    '../hooks/useRemoveRoundPlayer':{useRemoveRoundPlayer:()=>({})},
    '../hooks/useTransferGameMaster':{useTransferGameMaster:()=>({})},
  })
  const Page=h.load('src/pages/RoundDetailsPage.tsx').default
  h.render(Page,[])
  b.requests[0].resolve({data:roundData(),error:null});b.requests[1].resolve({data:[member(user,'game_master')],error:null});await tick()
  let tree=h.render()
  assert.ok(nodes(tree).some(n=>n.type==='AddRoundMemberSearch'))
  const oldKey=nodes(tree).find(n=>n.type==='RoundCharactersSection').key
  b.requests[2].resolve({data:[character('prepared',null)],error:null});b.requests[3].resolve({data:[character('trashed',null)],error:null});await tick()
  h.render()
  b.channels.find(c=>c.config.table==='round_memberships').cb();clock.advance()
  b.requests[4].resolve({data:roundData('player'),error:null})
  b.requests[5].resolve({data:[member(user,'player'),member('new-gm','game_master')],error:null});await tick()
  tree=h.render()
  assert.ok(!nodes(tree).some(n=>n.type==='AddRoundMemberSearch'))
  const section=nodes(tree).find(n=>n.type==='RoundCharactersSection')
  assert.equal(section.props.membershipRole,'player');assert.notEqual(section.key,oldKey)
  assert.equal(section.props.characterList.characters.length,0)
  assert.equal(section.props.characterTrash.characters.length,0)
  assert.equal(b.requests[6].signal.aborted,true);assert.equal(b.requests[7].signal.aborted,true)
  h.cleanup()
})
test('round-only changes preserve open round-edit form identity and its local fields',async()=>{
  const b=backend(),clock=browserClock(),h=harness(b.api,clock,{
    'react-router-dom':{useParams:()=>({roundId:round}),Link:'Link'},
    '../auth/useAuth':{useAuth:()=>({user:{id:user}})},
    '../components/AddRoundMemberSearch':{default:'AddRoundMemberSearch'},
    '../components/EditRoundForm':{default:'EditRoundForm'},
    '../components/RoundCharactersSection':{default:'RoundCharactersSection'},
    '../hooks/useRemoveRoundPlayer':{useRemoveRoundPlayer:()=>({})},
    '../hooks/useTransferGameMaster':{useTransferGameMaster:()=>({})},
  })
  const Page=h.load('src/pages/RoundDetailsPage.tsx').default
  h.render(Page,[]);b.requests[0].resolve({data:roundData(),error:null});b.requests[1].resolve({data:[member(user,'game_master')],error:null});await tick()
  let tree=h.render()
  nodes(tree).find(n=>n.type==='button'&&textOf(n)==='Bearbeiten').props.onClick()
  tree=h.render();assert.ok(nodes(tree).some(n=>n.type==='EditRoundForm'))
  b.channels.find(c=>c.config.table==='rounds').cb();clock.advance()
  assert.ok(nodes(h.render()).some(n=>n.type==='EditRoundForm'))
  b.requests[4].resolve({data:roundData('game_master',{name:'Server-Name'}),error:null});await tick()
  tree=h.render();const updatedForm=nodes(tree).find(n=>n.type==='EditRoundForm');assert.ok(updatedForm)
  const editHarness=harness(b.api,{}, {'../auth/useAuth':{useAuth:()=>({user:{id:user}})}})
  const Form=editHarness.load('src/components/EditRoundForm.tsx').default
  let form=editHarness.render(Form,[{round:roundData().round,onUpdated(){},onCancel(){}}])
  nodes(form).find(n=>n.props?.id==='edit-round-name').props.onChange({target:{value:'Lokaler Entwurf'}})
  form=editHarness.render(Form,[{...updatedForm.props}])
  assert.equal(nodes(form).find(n=>n.props?.id==='edit-round-name').props.value,'Lokaler Entwurf')
  h.cleanup();editHarness.cleanup()
})

test('round unlock event refreshes previously empty memberships and restores the visible view',async()=>{
  const b=backend(),clock=browserClock(),h=harness(b.api,clock,{
    'react-router-dom':{useParams:()=>({roundId:round}),Link:'Link'},
    '../auth/useAuth':{useAuth:()=>({user:{id:user}})},
    '../components/AddRoundMemberSearch':{default:'AddRoundMemberSearch'},
    '../components/EditRoundForm':{default:'EditRoundForm'},
    '../components/RoundCharactersSection':{default:'RoundCharactersSection'},
    '../hooks/useRemoveRoundPlayer':{useRemoveRoundPlayer:()=>({})},
    '../hooks/useTransferGameMaster':{useTransferGameMaster:()=>({})},
  })
  const Page=h.load('src/pages/RoundDetailsPage.tsx').default
  h.render(Page,[])
  b.requests[0].resolve({data:null,error:null});b.requests[1].resolve({data:[],error:null});await tick()
  assert.ok(!nodes(h.render()).some(n=>n.type==='RoundCharactersSection'))
  assert.equal(b.channels.length,3)
  b.channels.find(c=>c.config.table==='rounds').cb();clock.advance()
  assert.equal(b.requests.length,4)
  b.requests[2].resolve({data:roundData('player'),error:null});await tick()
  assert.ok(!nodes(h.render()).some(n=>n.type==='RoundCharactersSection'))
  b.requests[3].resolve({data:[member()],error:null});await tick()
  const tree=h.render()
  assert.ok(nodes(tree).some(n=>n.type==='RoundCharactersSection'))
  assert.equal(b.requests[4].table,'characters')
  h.cleanup()
})

for (const [name, action, input] of [
  ['useAddRoundPlayer', 'addPlayer', [round, other]],
  ['useRemoveRoundPlayer', 'removePlayer', [round, other]],
  ['useTransferGameMaster', 'transferGameMaster', [round, other]],
  ['useUpdateRound', 'updateRound', [round, {name:'Runde',system:'',description:'',appointment:'',status:'active'}]],
]) {
  test(`${name}: success expires after 4s, new actions restart/cancel the timer, errors persist`, async()=>{
    const b=backend(), clock=browserClock(), h=harness(b.api,clock,{
      '../auth/useAuth':{useAuth:()=>({session:{},user:{id:user}})},
    })
    const hook=h.load(`src/hooks/${name}.ts`)[name]
    h.render(hook,[])
    const succeed=async()=>{
      const pending=h.render()[action](...input)
      b.requests.at(-1).resolve({data:roundData().round,error:null})
      await pending
      assert.equal(h.render().isSuccess,true)
      assert.equal(clock.pending(),1)
    }
    await succeed()
    clock.advance(3999);assert.equal(h.render().isSuccess,true)
    clock.advance(1);assert.equal(h.render().isSuccess,false)
    assert.equal(clock.pending(),0)
    await succeed();clock.advance(3000)
    // No intermediate render: even batched success -> submitting -> success
    // must give the new success its full duration.
    await succeed();clock.advance(1000);assert.equal(h.render().isSuccess,true)
    clock.advance(2999);assert.equal(h.render().isSuccess,true)
    clock.advance(1);assert.equal(h.render().isSuccess,false)
    await succeed();clock.advance(3000)
    const failed=h.render()[action](...input)
    assert.equal(h.render().isSuccess,false);assert.equal(clock.pending(),0)
    assert.equal(h.render().isSubmitting,true)
    b.requests.at(-1).resolve({data:null,error:{message:'failure'}});await failed
    const error=h.render().error;assert.ok(error)
    clock.advance(10000);assert.equal(h.render().error,error)
    await succeed();h.render().resetState();h.render();assert.equal(clock.pending(),0)
    await succeed();h.replayEffects();assert.equal(clock.pending(),1)
    h.cleanup();assert.equal(clock.pending(),0)
    clock.advance(10000)
  })
}

test('success timer cleanup prevents state writes after unmount; stale expiry cannot clear a newer error',()=>{
  const clock=browserClock(), h=harness({},clock)
  const {useSuccessNoticeTimeout:hook}=h.load('src/hooks/useSuccessNoticeTimeout.ts')
  let state={isSuccess:true,error:null}, writes=0
  const setState=update=>{writes++;state=update(state)}
  h.render(hook,[state,setState]);assert.equal(clock.pending(),1)
  h.cleanup();clock.advance(10000);assert.equal(writes,0)
  const next=harness({},clock), nextHook=next.load('src/hooks/useSuccessNoticeTimeout.ts').useSuccessNoticeTimeout
  next.render(nextHook,[state,setState])
  // A state change may precede the next effect cleanup.
  state={isSuccess:false,error:'New request failed'}
  clock.advance(4000);assert.equal(state.error,'New request failed');assert.equal(state.isSuccess,false)
  next.cleanup()
})

for(const role of ['player','game_master']) {
  test(`rounds UPDATE adopts archive/unarchive in visible ${role} page without focus, reload or channel rebuild`,async()=>{
    const b=backend(),clock=browserClock(),h=harness(b.api,clock,{
      'react-router-dom':{useParams:()=>({roundId:round}),Link:'Link'},
      '../auth/useAuth':{useAuth:()=>({user:{id:user}})},
      '../components/AddRoundMemberSearch':{default:'AddRoundMemberSearch'},
      '../components/EditRoundForm':{default:'EditRoundForm'},
      '../components/RoundCharactersSection':{default:'RoundCharactersSection'},
      '../hooks/useRemoveRoundPlayer':{useRemoveRoundPlayer:()=>({})},
      '../hooks/useTransferGameMaster':{useTransferGameMaster:()=>({})},
    })
    const Page=h.load('src/pages/RoundDetailsPage.tsx').default
    const ownMembers=[member(user,role)]
    const resolveReads=(start,status)=>{
      for(const request of b.requests.slice(start)) {
        const data=request.table==='characters' ? [] : request.single ? roundData(role,{status}) : ownMembers
        request.resolve({data,error:null})
      }
    }
    h.render(Page,[]);resolveReads(0,'active');await tick()
    let tree=h.render();resolveReads(2,'active');await tick()
    const sectionKey=nodes(tree).find(n=>n.type==='RoundCharactersSection').key
    const channel=b.channels.find(c=>c.config.table==='rounds')
    assert.equal(channel.config.schema,'public');assert.equal(channel.config.event,'UPDATE')
    assert.equal(channel.config.filter,`id=eq.${round}`)
    let start=b.requests.length
    channel.status('SUBSCRIBED');clock.advance()
    assert.ok(b.requests.length>start)
    resolveReads(start,'active');await tick();h.render()
    for(const [status,label,oldLabel] of [['archived','Archiviert','Aktiv'],['paused','Pausiert','Archiviert']]) {
      start=b.requests.length
      channel.cb({new:{status:'deliberately-wrong-payload'}});clock.advance()
      const details=b.requests.slice(start).find(r=>r.single)
      assert.ok(details,'rounds event must issue round-details SELECT')
      assert.equal(details.table,'round_memberships');assert.equal(details.round_id,round);assert.equal(details.user_id,user)
      assert.match(details.fields,/round:rounds!inner/);assert.match(details.fields,/\bstatus\b/)
      assert.ok(nodes(h.render()).some(n=>n.props?.className?.includes('round-status-')&&textOf(n)===oldLabel))
      resolveReads(start,status);await tick();tree=h.render()
      assert.ok(nodes(tree).some(n=>n.props?.className?.includes(`round-status-${status}`)&&textOf(n)===label))
      const section=nodes(tree).find(n=>n.type==='RoundCharactersSection')
      assert.equal(section.props.roundStatus,status);assert.equal(section.key,sectionKey)
      assert.equal(section.props.membershipRole,role)
      assert.equal(b.channels.length,3);assert.equal(b.removals.length,0)
    }
    h.cleanup();assert.equal(b.removals.length,3)
  })
}

const sheetData=(overrides={})=>({
  ...character(other),name:'Servername',round_id:round,created_at:'2026-09-01',
  created_by_user_id:user,round:{locked_at:null},data:{check:false,note:'Server'},...overrides,
})
function sheetSetup() {
  const b=backend(),clock=browserClock(),h=harness(b.api,clock),{useCharacter:hook}=h.load('src/hooks/useCharacter.ts')
  h.render(hook,[other,user])
  return {b,clock,h,hook}
}
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}

test('character silent reads coalesce; transient errors preserve content; denial/soft deletion clear it',async()=>{
  const {b,h}=sheetSetup()
  b.requests[0].resolve({data:sheetData(),error:null});await settle()
  const before=h.render().character
  for(let i=0;i<10;i++)void h.render().reload()
  assert.equal(h.render().character,before);assert.equal(h.render().isLoading,false)
  assert.equal(b.requests.length,2)
  b.requests[1].resolve({data:sheetData({name:'Remote'}),error:null});await settle()
  assert.equal(b.requests.length,3);assert.equal(h.render().character.name,'Remote')
  b.requests[2].reject(Error('network'));await settle()
  assert.equal(h.render().character.name,'Remote');assert.equal(h.render().error,null)
  assert.equal(h.render().isRefreshing,false)
  for(const response of [{data:null,error:null},{data:null,error:{code:'42501'}},{data:sheetData({deleted_at:'today'}),error:null}]) {
    void h.render().reload();b.requests.at(-1).resolve(response);await settle()
    assert.equal(h.render().character,null);assert.ok(h.render().error)
    assert.equal(h.render().roundId,round,'only the round dependency survives for recovery')
  }
  void h.render().reload();b.requests.at(-1).resolve({data:sheetData(),error:null});await settle()
  assert.ok(h.render().character);h.cleanup()
})

test('character scope/account/logout and StrictMode abort reads and ignore obsolete replies',async()=>{
  const {b,h,hook}=sheetSetup();h.replayEffects()
  assert.equal(b.requests[0].signal.aborted,true)
  b.requests[1].resolve({data:sheetData(),error:null});await settle()
  b.requests[0].resolve({data:null,error:null});await settle();assert.ok(h.render().character)
  void h.render().reload();const old=b.requests.at(-1)
  h.render(hook,[round,user]);assert.equal(old.signal.aborted,true)
  assert.equal(h.render().character,null)
  b.requests.at(-1).resolve({data:sheetData({id:round,name:'Next'}),error:null});await settle()
  old.resolve({data:sheetData({name:'Obsolete'}),error:null});await settle()
  assert.equal(h.render().character.name,'Next')
  h.render(hook,[round,'other-account']);assert.equal(h.render().character,null)
  const accountRead=b.requests.at(-1)
  h.render(hook,[round,undefined]);assert.equal(accountRead.signal.aborted,true)
  accountRead.resolve({data:sheetData(),error:null});await settle();assert.equal(h.render().character,null)
  const count=b.requests.length
  await h.render().reload();assert.equal(b.requests.length,count)
  h.cleanup()
})

test('in-flight reads and invalidations wait for all own writes, then reconcile canonical checks',async()=>{
  const {b,h}=sheetSetup()
  b.requests[0].resolve({data:sheetData(),error:null});await settle()
  void h.render().reload();const staleRead=b.requests[1]
  const finishFirst=h.render().beginWrite(),finishSecond=h.render().beginWrite()
  h.render().updateCharacterDataField('check',true)
  h.render().updateCharacterDataField('another',true)
  for(let i=0;i<10;i++)void h.render().reload()
  staleRead.resolve({data:sheetData(),error:null});await settle()
  assert.equal(h.render().character.data.check,true)
  assert.equal(h.render().character.data.another,true);assert.equal(b.requests.length,2)
  finishFirst();await settle();assert.equal(b.requests.length,2)
  finishSecond();assert.equal(b.requests.length,3)
  b.requests[2].resolve({data:sheetData({data:{check:false,another:true}}),error:null});await settle()
  assert.equal(h.render().character.data.check,false);assert.equal(h.render().character.data.another,true)
  const finishAfterUnmount=h.render().beginWrite();h.cleanup();finishAfterUnmount()
  assert.equal(b.requests.length,3)
})

test('character channels use exact scopes, reconcile focus/reconnect and clean up under StrictMode',()=>{
  const b=backend(),clock=browserClock(),h=harness(b.api,clock)
  const {useCharacterRealtime:hook}=h.load('src/hooks/useCharacterRealtime.ts')
  let refreshes=0
  const options={characterId:other,userId:user,roundId:round,reload:()=>refreshes++}
  h.render(hook,[options]);assert.equal(b.channels.length,3)
  for(const c of b.channels) {
    assert.equal(c.config.schema,'public')
    assert.equal(c.config.filter,c.config.table==='characters'?`id=eq.${other}`:c.config.table==='rounds'?`id=eq.${round}`:`round_id=eq.${round}`)
    assert.deepEqual(c.bindings.map(b=>b.config.event),c.config.table==='round_memberships'?['INSERT','UPDATE']:['UPDATE'])
    c.cb();c.status('SUBSCRIBED')
  }
  clock.window.dispatchEvent(new Event('focus'));clock.document.dispatchEvent(new Event('visibilitychange'))
  assert.equal(clock.pending(),1);clock.advance();assert.equal(refreshes,1)
  clock.document.visibilityState='hidden';clock.window.dispatchEvent(new Event('focus'));clock.advance();assert.equal(refreshes,1)
  clock.document.visibilityState='visible';clock.window.dispatchEvent(new Event('online'));clock.advance();assert.equal(refreshes,2)
  h.render(hook,[{...options,roundId:null}]);assert.equal(b.removals.length,2)
  h.render(hook,[{...options,roundId:other}]);assert.equal(b.channels.length,5)
  b.channels[0].cb();h.replayEffects();clock.advance();assert.equal(refreshes,2)
  const oldChannels=b.channels.slice(0,5)
  for(const c of oldChannels){c.cb();c.status('SUBSCRIBED')}
  clock.advance();assert.equal(refreshes,2)
  h.render(hook,[{...options,userId:undefined}]);clock.window.dispatchEvent(new Event('focus'));clock.advance()
  assert.equal(refreshes,2);assert.equal(b.removals.length,b.channels.length)
  h.render(hook,[{...options,characterId:'invalid'}]);assert.equal(b.removals.length,b.channels.length)
  h.cleanup();assert.equal(clock.pending(),0)
})

function sheetPageSetup() {
  const b=backend(),clock=browserClock()
  const route={characterId:other},auth={user:{id:user}}
  const idle=()=>({isSubmitting:false,error:null,resetState(){}})
  const h=harness(b.api,clock,{
    'react-router-dom':{useParams:()=>route,useLocation:()=>({}),useNavigate:()=>()=>{},Link:'Link'},
    '../auth/useAuth':{useAuth:()=>auth},
    '../characterTemplates':{findCharacterTemplate:()=>({name:'Test',sections:[]})},
    '../components/CharacterSheetRenderer':{CharacterSheetRenderer:'Sheet'},
    '../components/CharacterRoundAssignment':{default:'Assignment'},
    '../hooks/useCharacterPortrait':{useCharacterPortrait:()=>({portraitUrl:null,isLoading:false,error:null})},
    ...Object.fromEntries(['useCopyCharacter','useSoftDeleteCharacter','useRemoveCharacterPortrait','useUploadCharacterPortrait'].map(name=>[`../hooks/${name}`,{[name]:idle}])),
  })
  const Page=h.load('src/pages/CharacterPage.tsx').default
  const root=h.render(Page,[])
  h.render(root.type,[root.props])
  const resolveRead=async(data=sheetData(),error=null)=>{
    b.requests.at(-1).resolve({data,error});await settle();return h.render()
  }
  const emit=()=>{b.channels.find(c=>c.config.table==='characters').cb();clock.advance()}
  const sheet=()=>nodes(h.render()).find(n=>n.type==='Sheet')
  const edit=()=>{nodes(h.render()).find(n=>n.type==='button'&&textOf(n)==='Bearbeiten').props.onClick();return sheet()}
  const warning=()=>nodes(h.render()).find(n=>n.props?.className==='character-remote-notice')
  return {b,clock,h,root,Page,route,auth,resolveRead,emit,sheet,edit,warning}
}

test('read-mode character events update name/data/checks/assignment without replacing page identity',async()=>{
  const {b,h,root,resolveRead,emit,sheet}=sheetPageSetup()
  await resolveRead();assert.equal(sheet().props.mode,'view')
  const initial=sheet().props.character
  emit();assert.equal(sheet().props.character,initial)
  await resolveRead(sheetData({name:'Changed',data:{check:true},round_id:null,round:null}))
  assert.equal(sheet().props.character.name,'Changed');assert.equal(sheet().props.character.data.check,true)
  assert.equal(nodes(h.render()).find(n=>n.type==='Assignment').props.character.round_id,null)
  assert.equal(b.channels.length,3);assert.equal(b.removals.length,2)
  assert.equal(root.props.characterId,other);h.cleanup()
})

test('remote edit conflict preserves drafts, blocks RPC save, and explicit reload adopts the server baseline',async()=>{
  const {b,h,resolveRead,emit,sheet,edit,warning}=sheetPageSetup()
  await resolveRead();edit()
  sheet().props.onNameChange('Lokaler Name');sheet().props.onDataFieldChange('note','Lokaler Text')
  emit();await resolveRead(sheetData({name:'Remote',data:{check:true,note:'Remote'}}))
  assert.equal(sheet().props.draftName,'Lokaler Name');assert.equal(sheet().props.draftData.note,'Lokaler Text')
  assert.equal(sheet().props.draftData.check,false);assert.ok(warning())
  const before=b.requests.length
  await nodes(h.render()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}})
  assert.equal(b.requests.length,before)
  assert.equal(nodes(h.render()).find(n=>n.type==='button'&&textOf(n)==='Speichern').props.disabled,true)
  nodes(warning()).find(n=>n.type==='button').props.onClick()
  await resolveRead(null,{message:'offline'})
  assert.ok(warning());assert.equal(sheet().props.draftName,'Lokaler Name')
  nodes(warning()).find(n=>n.type==='button').props.onClick()
  await resolveRead(sheetData({name:'Latest',data:{check:true,note:'Latest'},updated_at:'new-revision'}))
  assert.equal(sheet().props.draftName,'Latest');assert.equal(sheet().props.draftData.check,true)
  assert.equal(warning(),undefined);assert.equal(sheet().props.mode,'edit')
  h.cleanup()
})

test('unchanged refetch is not a conflict; own save and late own events do not create a warning',async()=>{
  const {b,h,resolveRead,emit,sheet,edit,warning}=sheetPageSetup()
  await resolveRead();edit();sheet().props.onNameChange('Saved')
  emit();await resolveRead();assert.equal(warning(),undefined)
  const saving=nodes(h.render()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}})
  const rpc=b.requests.at(-1);assert.equal(rpc.rpc,'update_character');assert.equal(rpc.args.p_name,'Saved')
  assert.equal(rpc.args.p_data.note,'Server')
  emit();assert.equal(b.requests.at(-1),rpc)
  rpc.resolve({error:null});await saving
  assert.equal(sheet().props.mode,'view');assert.equal(warning(),undefined)
  await resolveRead(sheetData({name:'Saved',updated_at:'saved-revision'}))
  edit();assert.equal(sheet().props.draftName,'Saved')
  emit();await resolveRead(sheetData({name:'Saved',updated_at:'saved-revision'}))
  assert.equal(warning(),undefined);h.cleanup()
})

test('own optimistic check plus concurrent events always ends with server state, including RPC failures',async()=>{
  const {b,h,resolveRead,emit,sheet}=sheetPageSetup()
  await resolveRead()
  for(const fail of [false,true]) {
    sheet().props.onCheckChange('check',true)
    const rpc=b.requests.at(-1);assert.equal(rpc.rpc,'set_character_check')
    assert.equal(sheet().props.character.data.check,true)
    emit();assert.equal(b.requests.at(-1),rpc)
    rpc.resolve({error:fail?{message:'failed'}:null});await settle()
    assert.equal(b.requests.at(-1).table,'characters')
    await resolveRead(sheetData({data:{check:false,note:'Concurrent canonical state'}}))
    assert.equal(sheet().props.character.data.check,false)
    assert.equal(sheet().props.character.data.note,'Concurrent canonical state')
    if(fail)assert.match(textOf(h.render()),/Checkbox konnte nicht gespeichert/)
  }
  h.cleanup()
})

test('round lock retains a GM draft read-only; membership access loss clears content and retains recovery channel',async()=>{
  const {b,clock,h,resolveRead,sheet,edit,warning}=sheetPageSetup()
  await resolveRead(sheetData({owner_user_id:'someone-else'}));edit()
  sheet().props.onNameChange('GM draft')
  b.channels.find(c=>c.config.table==='rounds').cb();clock.advance()
  await resolveRead(sheetData({owner_user_id:'someone-else',round:{locked_at:'locked'}}))
  assert.equal(sheet().props.mode,'edit');assert.equal(sheet().props.draftName,'GM draft')
  assert.equal(sheet().props.isDisabled,true);assert.ok(warning())
  b.channels.find(c=>c.config.table==='round_memberships').cb();clock.advance()
  await resolveRead(null)
  assert.equal(sheet(),undefined);assert.match(textOf(h.render()),/Charakter nicht verfügbar/)
  assert.equal(b.removals.length,0)
  b.channels.find(c=>c.config.table==='round_memberships').cb();clock.advance()
  await resolveRead(sheetData({owner_user_id:'someone-else'}))
  assert.ok(sheet());h.cleanup()
})

test('character/account keys isolate draft and mutation lifetimes; background refresh leaves key stable',()=>{
  const {h,root,Page,route,auth}=sheetPageSetup()
  h.cleanup()
  assert.equal(h.render(Page,[]).key,root.key)
  route.characterId=round;assert.notEqual(h.render(Page,[]).key,root.key)
  route.characterId=other;auth.user={id:'other-user'};assert.notEqual(h.render(Page,[]).key,root.key)
  auth.user=undefined;assert.notEqual(h.render(Page,[]).key,root.key)
})

for(const [name,action,args,input] of [
  ['useUpdateCharacter','updateCharacter',[],[other,'Name',{check:true}]],
  ['useSetCharacterCheck','setCharacterCheck',[other],['check',true]],
]) {
  test(`${name}: pending RPC completion after unmount does not write component state`,async()=>{
    const b=backend(),h=harness(b.api),hook=h.load(`src/hooks/${name}.ts`)[name]
    const pending=h.render(hook,args)[action](...input)
    h.cleanup();const writes=h.stateWriteCount()
    b.requests[0].resolve({error:null});assert.equal(await pending,false)
    assert.equal(h.stateWriteCount(),writes)
  })
}

test('leaving edit mode after a remote conflict displays loaded server data and resets the next baseline',async()=>{
  const {b,h,resolveRead,emit,sheet,edit,warning}=sheetPageSetup()
  await resolveRead();edit();sheet().props.onNameChange('Discarded draft')
  emit();await resolveRead(sheetData({name:'Remote',updated_at:'remote-version'}));assert.ok(warning())
  nodes(h.render()).find(n=>n.type==='button'&&textOf(n)==='Abbrechen').props.onClick()
  assert.equal(sheet().props.mode,'view');assert.equal(sheet().props.character.name,'Remote')
  assert.equal(b.requests.at(-1).table,'characters')
  await resolveRead(sheetData({name:'Latest',updated_at:'latest-version'}));edit()
  assert.equal(sheet().props.draftName,'Latest');assert.equal(warning(),undefined);h.cleanup()
})
