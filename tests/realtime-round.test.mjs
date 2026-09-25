import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
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
    createContext(value) { return { value, Provider: 'ContextProvider' } },
    useContext(context) { return context.value },
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
    useSyncExternalStore(subscribe, getSnapshot) {
      react.useEffect(() => subscribe(() => {}), [subscribe])
      return getSnapshot()
    },
    useCallback(callback,deps) {
      const i=cursor++
      if (!slots[i] || !same(slots[i].deps,deps)) slots[i] = { deps, callback }
      return slots[i].callback
    },
    useEffectEvent(callback) {
      const ref=react.useRef(callback); ref.current=callback
      return react.useCallback((...a)=>ref.current(...a),[])
    },
    useLayoutEffect(effect,deps) { react.useEffect(effect,deps) },
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
      const request={rpc:name,args}
      const promise=new Promise((resolve,reject)=>requests.push(Object.assign(request,{resolve,reject})))
      promise.abortSignal=signal=>{request.signal=signal;return promise}
      promise.select=fields=>{request.fields=fields;return promise}
      promise.maybeSingle=()=>{request.single=true;return promise}
      promise.single=()=>{request.single=true;return promise}
      promise.overrideTypes=()=>promise
      return promise
    },
    from(table) {
      const query={ table }
      let resolve,reject
      const promise=new Promise((yes,no)=>{resolve=yes;reject=no})
      const chain={
        update(values){query.values=values;return chain},
        select(fields){ query.fields=fields; return chain },
        eq(key,value){query[key]=value;return chain},
        gt(key,value){query.gt={key,value};return chain},
        lt(key,value){query.lt={key,value};return chain},
        limit(value){query.limit=value;return chain},
        order(key,options){query.order={key,...options};return chain},
        is(key,value){query[key]=value;return chain},
        not(key,operator,value){query[key]={operator,value};return chain},
        maybeSingle(){query.single=true;return chain},
        single(){query.single=true;return chain},
        abortSignal(signal){query.signal=signal;return chain},
        overrideTypes(){requests.push({...query,resolve,reject});return promise},
      }
      return chain
    },
    channel(name,options) {
      // Match SDK topic reuse while removeChannel is still unresolved.
      const existing=channels.find(c=>c.name===name)
      if(existing) return existing
      const c={name, options, bindings:[], on(kind,config,cb){c.bindings.push({kind,config,cb});Object.assign(c,{kind,config,cb});return c},subscribe(status){c.status=status;return c}}
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
  const playLink=nodes(h.render()).find(n=>n.type==='Link'&&textOf(n)==='Zum Spieltisch')
  assert.equal(playLink.props.to,`/app/rounds/${round}/play`)
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

test('round edit uses one normalized RPC and preserves result, in-flight and error semantics',async()=>{
  const b=backend(),clock=browserClock(),h=harness(b.api,clock,{
    '../auth/useAuth':{useAuth:()=>({session:{},user:{id:user}})},
  })
  const hook=h.load('src/hooks/useUpdateRound.ts').useUpdateRound
  h.render(hook,[])
  const input={name:' Runde ',system:' ',description:' Beschreibung ',appointment:' Termin ',status:'paused'}
  const pending=h.render().updateRound(round,input)
  assert.equal(h.render().isSubmitting,true)
  assert.equal(await h.render().updateRound(round,input),null)
  assert.equal(b.requests.length,1)
  assert.equal(b.requests[0].rpc,'update_round')
  assert.deepEqual({...b.requests[0].args},{p_round_id:round,p_name:'Runde',p_system:null,
    p_description:'Beschreibung',p_appointment:'Termin',p_status:'paused'})
  assert.ok(b.requests[0].fields.includes('orphaned_at'))
  assert.equal(b.requests[0].single,true)
  const saved={...roundData().round,status:'paused',orphaned_at:null}
  b.requests[0].resolve({data:saved,error:null})
  assert.equal(await pending,saved)
  assert.equal(h.render().isSuccess,true)
  assert.equal(h.render().isSubmitting,false)
  const failed=h.render().updateRound(round,{...input,status:'archived'})
  assert.equal(b.requests[1].args.p_status,'archived')
  b.requests[1].resolve({data:null,error:{message:'Round is locked'}})
  assert.equal(await failed,null)
  assert.ok(h.render().error)
  assert.equal(h.render().isSuccess,false)
  assert.equal(h.render().isSubmitting,false)
  assert.equal(b.requests.length,2)
  assert.equal(b.channels.length,0)
  h.cleanup()
})

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

function sheetPageSetup(overrides = {}) {
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
    ...overrides,
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

for(const [name,key,good] of [
  ['useMyRounds','rounds',[roundData()]],
  ['useMyCharacters','characters',[character()]],
  ['useMyDeletedCharacters','characters',[{...character(),deleted_at:'today'}]],
]) {
  test(`${name}: silent refresh, trailing read, errors, account change and logout cleanup`,async()=>{
    const auth={user:{id:user}},b=backend(),h=harness(b.api,{}, {'../auth/useAuth':{useAuth:()=>auth}})
    const hook=h.load(`src/hooks/${name}.ts`)[name]
    h.render(hook,[user]);b.requests[0].resolve({data:good,error:null});await settle()
    const before=h.render()[key]
    for(let i=0;i<10;i++)h.render().reload()
    assert.equal(b.requests.length,2);assert.equal(h.render()[key],before);assert.equal(h.render().isLoading,false)
    b.requests[1].resolve({data:good,error:null});await settle();assert.equal(b.requests.length,3)
    b.requests[2].reject(Error('offline'));await settle();assert.equal(h.render()[key],good)
    h.render().reload();b.requests[3].resolve({data:[],error:null});await settle();assert.equal(h.render()[key].length,0)
    h.render().reload();const old=b.requests.at(-1)
    auth.user={id:'next-user'};h.render(hook,['next-user']);assert.equal(old.signal.aborted,true)
    old.resolve({data:good,error:null});await settle();assert.equal(h.render()[key].length,0)
    const next=b.requests.at(-1);auth.user=undefined;h.render(hook,[undefined]);assert.equal(next.signal.aborted,true)
    next.resolve({data:good,error:null});await settle();assert.equal(h.render()[key].length,0)
    const count=b.requests.length;h.render().reload();assert.equal(b.requests.length,count);h.cleanup()
  })
}

test('overview channels are user/round scoped, stable across reorder, and reconcile without DELETE',()=>{
  const b=backend(),clock=browserClock(),h=harness(b.api,clock)
  const hook=h.load('src/hooks/usePersonalOverviewRealtime.ts').usePersonalOverviewRealtime
  const calls={rounds:0,characters:0,trash:0}
  const options={userId:user,roundIds:[round,other],reloadRounds:()=>calls.rounds++,reloadCharacters:()=>calls.characters++,reloadTrash:()=>calls.trash++}
  h.render(hook,[options]);assert.equal(b.channels.length,3)
  const members=b.channels.find(c=>c.config.table==='round_memberships')
  const rounds=b.channels.find(c=>c.config.table==='rounds')
  const characters=b.channels.find(c=>c.config.table==='characters')
  assert.equal(members.config.filter,`user_id=eq.${user}`)
  assert.equal(characters.config.filter,`owner_user_id=eq.${user}`)
  assert.deepEqual(rounds.bindings.map(x=>x.config.filter),[round,other].sort().map(id=>`id=eq.${id}`))
  for(const c of b.channels)for(const binding of c.bindings)assert.ok(['INSERT','UPDATE'].includes(binding.config.event))
  members.bindings[0].cb();rounds.cb();clock.advance();assert.deepEqual(calls,{rounds:1,characters:0,trash:0})
  characters.bindings[0].cb();characters.cb();clock.advance();assert.deepEqual(calls,{rounds:1,characters:1,trash:1})
  h.render(hook,[{...options,roundIds:[other,round,round]}]);assert.equal(b.channels.length,3)
  h.render(hook,[{...options,roundIds:[]}]);assert.equal(b.removals.length,1);assert.equal(b.channels.length,3)
  clock.window.dispatchEvent(new Event('focus'));clock.document.dispatchEvent(new Event('visibilitychange'))
  clock.window.dispatchEvent(new Event('online'));members.status('SUBSCRIBED');clock.advance()
  assert.deepEqual(calls,{rounds:2,characters:2,trash:2})
  h.replayEffects();const count=calls.rounds
  for(const c of b.channels.slice(0,3)){c.cb();c.status('SUBSCRIBED')}
  clock.advance();assert.equal(calls.rounds,count)
  h.render(hook,[{...options,userId:undefined}]);clock.window.dispatchEvent(new Event('focus'));clock.advance()
  assert.equal(calls.rounds,count);assert.equal(b.removals.length,b.channels.length);h.cleanup()
})

test('round overview adopts membership/archiving and preserves archive tab and create disclosure identity',async()=>{
  const b=backend(),clock=browserClock(),h=harness(b.api,clock,{
    '../auth/useAuth':{useAuth:()=>({user:{id:user}})},
    'react-router-dom':{Link:'Link'},
    '../components/CreateRoundForm':{default:'CreateRoundForm'},
  })
  const Page=h.load('src/pages/RoundsPage.tsx').default
  h.render(Page,[]);b.requests[0].resolve({data:[],error:null});await settle();h.render()
  assert.equal(b.channels.length,1,'no global rounds channel for empty memberships')
  b.channels[0].bindings[0].cb();clock.advance()
  b.requests.at(-1).resolve({data:[roundData()],error:null});await settle()
  let tree=h.render();assert.match(textOf(tree),/Test-Runde/)
  const disclosure=nodes(tree).find(n=>n.type==='details');disclosure.props.ref.current={open:true}
  const create=nodes(tree).find(n=>n.type==='CreateRoundForm')
  nodes(tree).find(n=>n.type==='button'&&textOf(n)==='Archiv').props.onClick()
  b.channels.find(c=>c.config.table==='rounds').cb();clock.advance()
  assert.equal(nodes(h.render()).find(n=>n.type==='details').props.ref,disclosure.props.ref)
  b.requests.at(-1).resolve({data:[roundData('game_master',{status:'archived'})],error:null});await settle()
  tree=h.render();assert.match(textOf(tree),/Test-Runde/)
  assert.equal(nodes(tree).find(n=>n.type==='button'&&textOf(n)==='Archiv').props['aria-pressed'],true)
  assert.equal(nodes(tree).find(n=>n.type==='CreateRoundForm').key,create.key)
  assert.equal(nodes(tree).find(n=>n.type==='details').props.ref.current.open,true)
  b.channels.find(c=>c.config.table==='rounds').cb();clock.advance()
  b.requests.at(-1).resolve({data:[roundData('game_master',{status:'paused'})],error:null});await settle()
  assert.match(textOf(h.render()),/keine archivierten Runden/)
  clock.window.dispatchEvent(new Event('focus'));clock.advance()
  b.requests.at(-1).resolve({data:[],error:null});await settle();h.render()
  assert.equal(b.removals.length,1);h.cleanup()
})

test('character overview INSERT, soft delete and restore update both lists while trash tab/confirmation stay stable',async()=>{
  const b=backend(),clock=browserClock(),h=harness(b.api,clock,{
    '../auth/useAuth':{useAuth:()=>({user:{id:user}})},
    'react-router-dom':{Link:'Link'},
    '../characterTemplates':{findCharacterTemplate:()=>({name:'Test'})},
  })
  const Page=h.load('src/pages/CharactersPage.tsx').default
  const active=character('Test character'),deleted={...active,deleted_at:new Date().toISOString()}
  const resolveLists=async(start,live,trash)=>{
    for(const r of b.requests.slice(start))r.resolve({data:r.table==='round_memberships'?[]:r.deleted_at===null?live:trash,error:null})
    await settle();return h.render()
  }
  h.render(Page,[]);await resolveLists(0,[],[])
  const c=b.channels.find(c=>c.config.table==='characters')
  let start=b.requests.length;c.bindings[0].cb();clock.advance()
  await resolveLists(start,[active],[]);assert.match(textOf(h.render()),/Test character/)
  start=b.requests.length;c.cb();clock.advance();assert.match(textOf(h.render()),/Test character/)
  await resolveLists(start,[],[deleted]);assert.match(textOf(h.render()),/noch keine Charaktere/)
  nodes(h.render()).find(n=>n.type==='button'&&textOf(n)==='Papierkorb').props.onClick()
  nodes(h.render()).find(n=>n.type==='button'&&textOf(n)==='Wiederherstellen').props.onClick()
  start=b.requests.length;c.cb();clock.advance();await resolveLists(start,[],[deleted])
  assert.ok(nodes(h.render()).some(n=>n.type==='button'&&textOf(n)==='Abbrechen'))
  start=b.requests.length;c.cb();clock.advance();await resolveLists(start,[active],[])
  assert.match(textOf(h.render()),/Papierkorb ist leer/)
  assert.equal(nodes(h.render()).find(n=>n.type==='button'&&textOf(n)==='Papierkorb').props['aria-pressed'],true)
  nodes(h.render()).find(n=>n.type==='button'&&textOf(n)==='Charaktere').props.onClick()
  assert.match(textOf(h.render()),/Test character/);h.cleanup()
})

function portraitSetup() {
  const requests=[],created=[],revoked=[]
  const bucket={}
  for(const method of ['list','download','upload','remove'])bucket[method]=(...args)=>new Promise((resolve,reject)=>requests.push({method,args,resolve,reject}))
  const api={storage:{from(name){assert.equal(name,'character-portraits');return bucket}}}
  const urls={createObjectURL(blob){const url=`blob:${created.length}`;created.push({blob,url});return url},revokeObjectURL(url){revoked.push(url)}}
  const h=harness(api,{URL:urls}),hook=h.load('src/hooks/useCharacterPortrait.ts').useCharacterPortrait
  const metadata=v=>[{name:'portrait',id:'object',updated_at:v,metadata:{eTag:v}}]
  const finishImage=async(v)=>{
    requests.at(-1).resolve({data:metadata(v),error:null});await settle()
    assert.equal(requests.at(-1).method,'download')
    requests.at(-1).resolve({data:`image-${v}`,error:null});await settle();return h.render()
  }
  h.render(hook,[other,user])
  return {api,h,hook,requests,created,revoked,metadata,finishImage}
}

test('portrait reconciliation skips unchanged blobs, versions replacements, and clears remotely removed images',async()=>{
  const {h,requests,created,revoked,metadata,finishImage}=portraitSetup()
  await finishImage('v1');const first=h.render().portraitUrl
  assert.equal(requests[1].args[0],`${other}/portrait`)
  assert.equal(requests[1].args[2].cache,'no-store');assert.ok(requests[1].args[1].cacheNonce.includes('v1'))
  h.render().reconcile();assert.equal(h.render().portraitUrl,first);assert.equal(h.render().isLoading,false)
  requests.at(-1).resolve({data:metadata('v1'),error:null});await settle();assert.equal(created.length,1)
  h.render().reconcile();await finishImage('v2')
  assert.notEqual(h.render().portraitUrl,first);assert.deepEqual(revoked,[first])
  assert.ok(requests.at(-1).args[1].cacheNonce.includes('v2'))
  h.render().reconcile();requests.at(-1).reject(Error('offline'));await settle();assert.equal(h.render().portraitUrl,'blob:1')
  h.render().reconcile();requests.at(-1).resolve({data:[],error:null});await settle()
  assert.equal(h.render().portraitUrl,null);assert.equal(revoked.length,2);h.cleanup()
})

test('own portrait reload supersedes old reads; delete cannot be undone by stale responses; scope/unmount abort',async()=>{
  const {h,hook,requests,created,revoked,metadata,finishImage}=portraitSetup()
  await finishImage('old');h.render().reconcile();const oldList=requests.at(-1)
  h.render().reload();oldList.resolve({data:metadata('old'),error:null});await settle()
  assert.equal(requests.at(-1).method,'list');await finishImage('new')
  h.render().reload();requests.at(-1).resolve({data:metadata('third'),error:null});await settle()
  const obsoleteDownload=requests.at(-1);h.render().clearPortrait()
  assert.equal(obsoleteDownload.args[2].signal.aborted,true)
  obsoleteDownload.resolve({data:'deleted image',error:null});await settle();assert.equal(h.render().portraitUrl,null)
  assert.equal(created.length,2);assert.equal(revoked.length,2)
  h.render().reconcile();const oldScope=requests.at(-1);h.render(hook,[round,user])
  assert.equal(oldScope.args[2].signal.aborted,true)
  oldScope.resolve({data:metadata('obsolete'),error:null});await settle();assert.equal(h.render().portraitUrl,null)
  await finishImage('next');h.cleanup();const writes=h.stateWriteCount()
  h.render().reconcile();assert.equal(h.stateWriteCount(),writes);assert.equal(revoked.length,3)
})

test('portrait StrictMode cleans URLs/requests; permission failures revoke displayed content',async()=>{
  const {h,requests,revoked,metadata,finishImage}=portraitSetup()
  const initial=requests[0];h.replayEffects();assert.equal(initial.args[2].signal.aborted,true)
  initial.resolve({data:metadata('obsolete'),error:null});await settle()
  await finishImage('current');h.render().reconcile()
  requests.at(-1).resolve({data:null,error:{statusCode:'403'}});await settle()
  assert.equal(h.render().portraitUrl,null);assert.ok(h.render().error);assert.equal(revoked.length,1)
  h.cleanup()
})

test('portrait reconciles on focus/visible/online/subscription reconnect, not on every character check',()=>{
  const b=backend(),clock=browserClock(),h=harness(b.api,clock)
  const hook=h.load('src/hooks/useCharacterRealtime.ts').useCharacterRealtime
  let portraits=0,characters=0
  h.render(hook,[{characterId:other,userId:user,roundId:round,reload:()=>characters++,reconcilePortrait:()=>portraits++}])
  b.channels[0].cb();clock.advance();assert.equal(characters,1);assert.equal(portraits,0)
  clock.window.dispatchEvent(new Event('focus'));clock.document.dispatchEvent(new Event('visibilitychange'))
  for(const c of b.channels)c.status('SUBSCRIBED')
  clock.window.dispatchEvent(new Event('online'));clock.advance();assert.equal(portraits,1)
  h.cleanup();clock.window.dispatchEvent(new Event('focus'));clock.advance();assert.equal(portraits,1)
})

test('CharacterPage own portrait upload/replace force reload; successful remove clears the image',async()=>{
  let reloads=0,clears=0
  const storageRequests=[]
  const {b,h,resolveRead}=sheetPageSetup({
    '../hooks/useUploadCharacterPortrait':undefined,
    '../hooks/useRemoveCharacterPortrait':undefined,
    '../hooks/useCharacterPortrait':{useCharacterPortrait:()=>({
      portraitUrl:'blob:existing',isLoading:false,error:null,
      reload:()=>reloads++,reconcile(){},clearPortrait:()=>clears++,
    })},
  })
  b.api.storage={from(bucket){assert.equal(bucket,'character-portraits');return {
    upload:(...args)=>new Promise(resolve=>storageRequests.push({method:'upload',args,resolve})),
    remove:(...args)=>new Promise(resolve=>storageRequests.push({method:'remove',args,resolve})),
  }}}
  await resolveRead()
  const file={type:'image/png',size:1024}
  nodes(h.render()).find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[file],value:'selected'}})
  const upload=storageRequests.at(-1)
  assert.equal(upload.args[0],`${other}/portrait`);assert.equal(upload.args[2].upsert,true)
  assert.equal(reloads,0);upload.resolve({error:null});await settle();assert.equal(reloads,1)
  nodes(h.render()).find(n=>n.type==='button'&&textOf(n)==='Portrait entfernen').props.onClick()
  nodes(h.render()).find(n=>n.props?.className==='character-portrait-remove-confirm').props.onClick()
  const remove=storageRequests.at(-1);assert.equal(remove.method,'remove');assert.equal(remove.args[0][0],`${other}/portrait`)
  assert.equal(clears,0);remove.resolve({error:null});await settle();assert.equal(clears,1)
  h.cleanup()
})

const profileData=(overrides={})=>({id:user,username:'username',display_name:'Name',role:'user',is_superadmin:false,deletion_pending_at:null,created_at:'2026-09-01',updated_at:'v1',...overrides})
function profileSetup() {
  const b=backend(),clock=browserClock(),auth={user:{id:user}}
  const h=harness(b.api,clock,{'./useAuth':{useAuth:()=>auth}})
  const Provider=h.load('src/auth/ProfileProvider.tsx').default
  const context=h.load('src/auth/ProfileContext.ts').ProfileContext
  const useProfile=h.load('src/hooks/useProfile.ts').useProfile
  const render=()=>{
    const tree=h.render(Provider,[{}]);context.value=tree.props.value
    return useProfile(auth.user?.id)
  }
  render()
  return {b,h,clock,auth,Provider,context,useProfile,render}
}

test('one own-profile provider serves multiple consumers; UPDATE silently adopts role/name without payload patching',async()=>{
  const {b,h,clock,render,useProfile}=profileSetup()
  b.requests[0].resolve({data:profileData(),error:null});await settle()
  const first=render();assert.equal(b.channels.length,1)
  assert.equal(useProfile(user),first);assert.equal(useProfile(user),first)
  assert.equal(b.requests.length,1)
  const channel=b.channels[0]
  assert.equal(channel.config.table,'profiles');assert.equal(channel.config.event,'UPDATE')
  assert.equal(channel.config.filter,`id=eq.${user}`)
  channel.cb({new:{role:'admin',username:'untrusted'}});clock.advance()
  assert.equal(render().profile.role,'user');assert.equal(render().profile,first.profile)
  assert.equal(render().isLoading,false);assert.equal(b.requests[1].id,user)
  b.requests[1].resolve({data:profileData({role:'admin',username:'server-name',is_superadmin:true}),error:null});await settle()
  assert.equal(render().profile.role,'admin');assert.equal(useProfile(user).profile.username,'server-name')
  assert.equal(useProfile(user).profile.is_superadmin,true)
  channel.cb();clock.advance();b.requests[2].resolve({data:profileData(),error:null});await settle()
  assert.equal(render().profile.role,'user');assert.equal(b.channels.length,1);h.cleanup()
})

test('own profile queues reads, preserves data on transient errors, reconciles own save and clears denial',async()=>{
  const {b,h,render}=profileSetup()
  b.requests[0].resolve({data:profileData(),error:null});await settle();render()
  for(let i=0;i<10;i++)render().reload()
  assert.equal(b.requests.length,2)
  b.requests[1].reject(Error('offline'));await settle();assert.equal(render().profile.display_name,'Name')
  assert.equal(b.requests.length,3)
  const stale=b.requests[2]
  const save=render().updateDisplayName(' Saved ')
  const write=b.requests.at(-1);assert.equal(write.values.display_name,'Saved');assert.equal(Object.keys(write.values).length,1)
  stale.resolve({data:profileData({display_name:'Stale'}),error:null});await settle()
  assert.equal(render().profile.display_name,'Name');assert.equal(render().isSaving,true)
  write.resolve({data:profileData({display_name:'Saved'}),error:null});await save
  assert.equal(render().profile.display_name,'Saved')
  b.requests.at(-1).resolve({data:profileData({display_name:'Saved',role:'admin'}),error:null});await settle()
  assert.equal(render().profile.role,'admin')
  render().reload();b.requests.at(-1).resolve({data:null,error:{code:'42501'}});await settle()
  assert.equal(render().profile,null);assert.ok(render().error);h.cleanup()
})

test('profile user changes/logout/StrictMode clean channels, timers and obsolete reads or writes',async()=>{
  const {b,h,clock,auth,render}=profileSetup()
  h.replayEffects();assert.equal(b.requests[0].signal.aborted,true)
  assert.equal(b.channels.length,2);assert.equal(b.removals.length,1)
  b.requests[0].resolve({data:profileData({username:'stale'}),error:null})
  b.requests[1].resolve({data:profileData(),error:null});await settle();render()
  const save=render().updateDisplayName('old account write'),write=b.requests.at(-1)
  const oldChannel=b.channels.at(-1);oldChannel.cb()
  auth.user={id:'next-user'};assert.equal(render().profile,null);clock.advance()
  assert.equal(b.channels.length,3);assert.equal(b.removals.length,2)
  write.resolve({data:profileData({role:'admin'}),error:null});assert.equal(await save,null)
  const current=b.requests.at(-1)
  auth.user=undefined;render();assert.equal(current.signal.aborted,true)
  current.resolve({data:profileData({id:'next-user'}),error:null});await settle()
  oldChannel.cb();oldChannel.status('SUBSCRIBED');clock.advance()
  assert.equal(render().profile,null);assert.equal(b.removals.length,3);assert.equal(clock.pending(),0);h.cleanup()
})

test('profile draft is scoped to profile ID, survives background changes and resets after explicit save',async()=>{
  let state={profile:profileData(),isLoading:false,error:null,isSaving:false,saveError:null,reload(){},updateDisplayName:async()=>profileData({display_name:'Draft'})}
  const h=harness({}, {}, {
    '../auth/useAuth':{useAuth:()=>({user:{id:state.profile.id}})},
    '../hooks/useProfile':{useProfile:()=>state},
    '../components/EmailChangeForm':{default:'EmailChangeForm'},
    '../components/PasswordChangeForm':{default:'PasswordChangeForm'},
  })
  const Page=h.load('src/pages/ProfilePage.tsx').default
  const input=()=>nodes(h.render()).find(n=>n.props?.id==='display-name')
  h.render(Page,[]);input().props.onChange({target:{value:'Draft'}})
  state={...state,profile:profileData({display_name:'Remote',updated_at:'v2',role:'admin'})}
  assert.equal(input().props.value,'Draft');assert.match(textOf(h.render()),/Kultistenführer/)
  await nodes(h.render()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}})
  assert.equal(input().props.value,'Remote','after save draft ends and current shared state supplies the input')
  input().props.onChange({target:{value:'Old user draft'}})
  state={...state,profile:profileData({id:'next-user',display_name:'Next'})}
  assert.equal(input().props.value,'Next');h.cleanup()
})

test('RequireAdmin reacts to authorized role changes without loading/remount state on background reads',()=>{
  let profile=profileData({role:'admin'})
  const h=harness({}, {}, {
    '../auth/useAuth':{useAuth:()=>({user:{id:user},isLoading:false})},
    '../hooks/useProfile':{useProfile:()=>({profile,isLoading:false,error:null,reload(){}})},
    'react-router-dom':{Navigate:'Navigate',Outlet:'Outlet'},
  })
  const Guard=h.load('src/routes/RequireAdmin.tsx').default
  assert.equal(h.render(Guard,[]).type,'Outlet')
  profile=profileData();assert.equal(h.render().type,'Navigate');assert.equal(h.render().props.to,'/app')
  profile=profileData({role:'admin',is_superadmin:true});assert.equal(h.render().props.context.currentProfile.is_superadmin,true)
  h.cleanup()
})

for(const [name,key,data,args] of [
  ['useAdminUsers','users',[profileData()],[user]],
  ['useAdminRounds','rounds',[{...roundData().round,round_memberships:[]}],[user]],
  ['useAdminRoundDetails','round',roundData().round,[round,user]],
]) {
  test(`${name}: focus events coalesce silent reads, reconnect refreshes, old scope/denial clear safely`,async()=>{
    const b=backend(),clock=browserClock(),h=harness(b.api,clock)
    const hook=h.load(`src/hooks/${name}.ts`)[name]
    const focus=h.load('src/hooks/useFocusReconciliation.ts').useFocusReconciliation
    const render=(scope,hookArgs,reconnect=0)=>{
      const state=hook(...hookArgs)
      focus(scope,state.reload,reconnect)
      return state
    }
    h.render(render,[user,args]);b.requests[0].resolve({data,error:null});await settle()
    const initial=h.render()[key]
    clock.window.dispatchEvent(new Event('focus'));clock.document.dispatchEvent(new Event('visibilitychange'));clock.window.dispatchEvent(new Event('online'))
    clock.advance();assert.equal(b.requests.length,2);assert.equal(h.render()[key],initial);assert.equal(h.render().isLoading,false)
    clock.window.dispatchEvent(new Event('focus'));clock.advance()
    b.requests[1].resolve({data,error:null});await settle();assert.equal(b.requests.length,3)
    b.requests[2].reject(Error('offline'));await settle();assert.ok(h.render()[key]);assert.equal(h.render().error,null)
    h.render(render,[user,args,1]);clock.advance();assert.equal(b.requests.length,4)
    b.requests[3].resolve({data:null,error:{code:'42501'}});await settle()
    assert.equal(key==='round'?h.render().round:h.render()[key].length,key==='round'?null:0)
    h.render().reload();const stale=b.requests.at(-1)
    h.render(render,['next',name==='useAdminRoundDetails'?[other,'next']:['next'],1]);assert.equal(stale.signal.aborted,true)
    stale.resolve({data,error:null});await settle();assert.equal(key==='round'?h.render().round:h.render()[key].length,key==='round'?null:0)
    h.cleanup();const count=b.requests.length;clock.advance();clock.window.dispatchEvent(new Event('focus'));clock.advance();assert.equal(b.requests.length,count)
    assert.equal(b.channels.length,0)
  })
}

test('admin browser return hook ignores hidden returns and cancels timers on scope change/StrictMode/unmount',()=>{
  const clock=browserClock(),h=harness({},clock)
  const hook=h.load('src/hooks/useFocusReconciliation.ts').useFocusReconciliation
  let calls=0;const reload=()=>calls++
  h.render(hook,[user,reload,0]);clock.document.visibilityState='hidden'
  clock.window.dispatchEvent(new Event('focus'));clock.document.dispatchEvent(new Event('visibilitychange'));clock.advance();assert.equal(calls,0)
  clock.document.visibilityState='visible';clock.window.dispatchEvent(new Event('focus'))
  h.replayEffects();clock.advance();assert.equal(calls,0)
  clock.window.dispatchEvent(new Event('focus'));h.render(hook,['next',reload,0]);clock.advance();assert.equal(calls,0)
  clock.window.dispatchEvent(new Event('online'));clock.window.dispatchEvent(new Event('focus'));clock.advance();assert.equal(calls,1)
  h.render(hook,['next',reload,1]);clock.advance();assert.equal(calls,2)
  h.cleanup();clock.window.dispatchEvent(new Event('focus'));clock.advance();assert.equal(calls,2)
})

test('layout wraps all profile consumers once and updates username/admin navigation from shared state',()=>{
  let profile=profileData()
  const h=harness({}, {}, {
    '../auth/useAuth':{useAuth:()=>({user:{id:user}})},
    '../auth/ProfileProvider':{default:'ProfileProvider'},
    '../hooks/useProfile':{useProfile:()=>({profile})},
    '../lib/environment':{isProductionEnvironment:true},
    'react-router-dom':{useLocation:()=>({key:'route'}),Link:'Link',NavLink:'NavLink',Outlet:'Outlet'},
  })
  const Layout=h.load('src/layouts/AppLayout.tsx').default
  const root=h.render(Layout,[]);assert.equal(root.type,'ProfileProvider')
  const Content=root.props.children.type
  let tree=h.render(Content,[]);assert.match(textOf(tree),/username/)
  assert.ok(!nodes(tree).some(n=>n.props?.to==='/app/admin'))
  profile=profileData({role:'admin',username:'new-username'})
  tree=h.render();assert.match(textOf(tree),/new-username/)
  assert.ok(nodes(tree).some(n=>n.props?.to==='/app/admin'))
  profile=profileData();assert.ok(!nodes(h.render()).some(n=>n.props?.to==='/app/admin'));h.cleanup()
})

for(const details of [false,true]) {
  test(`admin ${details?'round detail':'overview'} page wires browser/reconnect refreshes without broad subscriptions`,async()=>{
    const b=backend(),clock=browserClock();let reconnectVersion=0
    const profile=profileData({role:'admin',is_superadmin:true})
    const h=harness(b.api,clock,{
      '../auth/useAuth':{useAuth:()=>({user:{id:user}})},
      '../hooks/useProfile':{useProfile:()=>({reconnectVersion})},
      'react-router-dom':{useOutletContext:()=>({currentProfile:profile}),useParams:()=>({roundId:round}),useSearchParams:()=>[new URLSearchParams(),()=>{}],Link:'Link'},
      '../components/OrphanedRoundRecovery':{default:'Recovery'},
    })
    const Page=h.load(`src/pages/${details?'AdminRoundDetailsPage':'AdminPage'}.tsx`).default
    const resolveReads=async(start)=>{
      for(const r of b.requests.slice(start))r.resolve({data:details?(r.table==='rounds'?roundData('game_master',{orphaned_at:'today'}).round:[member()]):r.table==='profiles'?[profile]:[{...roundData().round,round_memberships:[]}],error:null})
      await settle();return h.render()
    }
    h.render(Page,[]);let tree=await resolveReads(0)
    if(details)assert.ok(nodes(tree).some(n=>n.type==='Recovery'))
    const start=b.requests.length
    clock.window.dispatchEvent(new Event('focus'));clock.document.dispatchEvent(new Event('visibilitychange'));clock.advance()
    assert.equal(b.requests.length,start+2)
    assert.ok(!textOf(h.render()).includes('wird geladen...'))
    tree=await resolveReads(start);if(details)assert.ok(nodes(tree).some(n=>n.type==='Recovery'))
    reconnectVersion++;h.render();clock.advance();assert.equal(b.requests.length,start+4)
    assert.equal(b.channels.length,0);h.cleanup();assert.equal(clock.pending(),0)
  })
}

// Phase 2.16g: closing review. These assertions express the required cleanup
// behavior; a failure is an open review finding, not an expected-pass snapshot.
test('publication migrations add only the Phase 2 tables and Phase 3.1 chat with individual existence guards',()=>{
  const directory='supabase/migrations'
  const publications=readdirSync(directory).sort().map(name=>({name,sql:readFileSync(`${directory}/${name}`,'utf8')}))
    .filter(({sql})=>/\bpublication\b/i.test(sql))
  const tables=[]
  for(const {name,sql} of publications){
    assert.doesNotMatch(sql,/\b(?:drop|create)\s+publication\b|\bset\s+table\b|\b(?:grant|revoke|policy|trigger)\b|\breplica\s+identity\b/i,name)
    const additions=[...sql.matchAll(/alter\s+publication\s+supabase_realtime\s+add\s+table\s+public\.(\w+)\s*;/gi)]
    assert.ok(additions.length>0,name)
    for(const [,table] of additions){
      const guard=new RegExp(`if\\s+not\\s+exists\\s*\\(\\s*select\\s+1\\s+from\\s+(?:pg_catalog\\.)?pg_publication_tables\\s+where\\s+pubname\\s*=\\s*'supabase_realtime'\\s+and\\s+schemaname\\s*=\\s*'public'\\s+and\\s+tablename\\s*=\\s*'${table}'\\s*\\)\\s+then\\s+alter\\s+publication\\s+supabase_realtime\\s+add\\s+table\\s+public\\.${table}\\s*;\\s*end\\s+if`, 'i')
      assert.match(sql,guard,`${name}: ${table}`)
      tables.push(table)
    }
  }
  assert.deepEqual(tables.sort(),['characters','profiles','round_memberships','round_messages','rounds'])
})

for(const action of ['copy','delete']) {
  test(`review: character ${action} completion after navigation must not redirect the new page`,async()=>{
    const navigations=[]
    const {b,h,resolveRead}=sheetPageSetup({
      '../hooks/useCopyCharacter':undefined,
      '../hooks/useSoftDeleteCharacter':undefined,
      'react-router-dom':{useParams:()=>({characterId:other}),useLocation:()=>({}),useNavigate:()=> (...args)=>navigations.push(args),Link:'Link'},
    })
    await resolveRead()
    nodes(h.render()).find(n=>n.props?.className===`character-${action}-trigger`).props.onClick()
    nodes(h.render()).find(n=>n.props?.className===`character-${action}-confirm`).props.onClick()
    const request=b.requests.at(-1)
    assert.equal(request.rpc,action==='copy'?'copy_character':'soft_delete_character')
    h.cleanup();const writes=h.stateWriteCount()
    request.resolve({data:action==='copy'?round:null,error:null});await settle()
    assert.deepEqual(navigations,[],'an obsolete CharacterPage must not navigate after unmount')
    assert.equal(h.stateWriteCount(),writes,'completed action must not update an unmounted component')
  })
}

for(const [name,action,args] of [
  ['useUploadCharacterPortrait','uploadCharacterPortrait',[other,{type:'image/png',size:1024}]],
  ['useRemoveCharacterPortrait','removeCharacterPortrait',[other]],
]) {
  test(`review: ${name} completion after unmount must not write state`,async()=>{
    let finish
    const request=new Promise(resolve=>{finish=resolve})
    const h=harness({storage:{from:()=>({upload:()=>request,remove:()=>request})}})
    const hook=h.load(`src/hooks/${name}.ts`)[name]
    const pending=h.render(hook,[])[action](...args)
    h.cleanup();const writes=h.stateWriteCount()
    finish({error:null});await pending
    assert.equal(h.stateWriteCount(),writes,'storage completion must not update an unmounted component')
  })
}

test('review: profile save completing after leaving ProfilePage must not update its local draft state',async()=>{
  // The shared ProfileProvider remains mounted across navigation within /app.
  // Its successful save legitimately resolves even after ProfilePage unmounts.
  let finish
  const pending=new Promise(resolve=>{finish=resolve})
  const h=harness({}, {}, {
    '../auth/useAuth':{useAuth:()=>({user:{id:user}})},
    '../hooks/useProfile':{useProfile:()=>({profile:profileData(),isLoading:false,isSaving:false,updateDisplayName:()=>pending})},
    '../components/EmailChangeForm':{default:'EmailChangeForm'},
    '../components/PasswordChangeForm':{default:'PasswordChangeForm'},
  })
  const Page=h.load('src/pages/ProfilePage.tsx').default
  h.render(Page,[])
  nodes(h.render()).find(n=>n.props?.id==='display-name').props.onChange({target:{value:'Draft'}})
  const submitted=nodes(h.render()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}})
  h.cleanup();const writes=h.stateWriteCount()
  finish(profileData({display_name:'Draft'}));await submitted
  assert.equal(h.stateWriteCount(),writes,'shared save may finish, but the departed page must not set state')
})

for(const action of ['copy','delete']) {
  test(`cleanup fix: ${action} keeps normal navigation but discards responses across keyed character/account changes`,async()=>{
    const navigations=[]
    const setup=(id,account)=>sheetPageSetup({
      '../hooks/useCopyCharacter':undefined,
      '../hooks/useSoftDeleteCharacter':undefined,
      '../auth/useAuth':{useAuth:()=>({user:{id:account}})},
      'react-router-dom':{useParams:()=>({characterId:id}),useLocation:()=>({}),useNavigate:()=> (...args)=>navigations.push(args),Link:'Link'},
    })
    const start=fixture=>{
      nodes(fixture.h.render()).find(n=>n.props?.className===`character-${action}-trigger`).props.onClick()
      nodes(fixture.h.render()).find(n=>n.props?.className===`character-${action}-confirm`).props.onClick()
      return fixture.b.requests.at(-1)
    }
    const current=setup(other,user);await current.resolveRead()
    start(current).resolve({data:action==='copy'?round:null,error:null});await settle()
    assert.equal(navigations[0][0],action==='copy'?`/app/characters/${round}`:'/app/characters')
    const late=start(current);current.h.cleanup();const oldWrites=current.h.stateWriteCount()
    const next=setup(round,'next-user');assert.notEqual(next.root.key,current.root.key)
    await next.resolveRead(sheetData({id:round,owner_user_id:'next-user',name:'Next character'}))
    const nextWrites=next.h.stateWriteCount()
    late.resolve({data:action==='copy'?other:null,error:null});await settle()
    assert.equal(navigations.length,1)
    assert.equal(current.h.stateWriteCount(),oldWrites);assert.equal(next.h.stateWriteCount(),nextWrites)
    assert.match(textOf(next.h.render()),/Next character/);next.h.cleanup()
  })
}

for(const name of ['useCopyCharacter','useSoftDeleteCharacter','useUploadCharacterPortrait','useRemoveCharacterPortrait']) {
  test(`cleanup fix: ${name} ignores obsolete success/error/rejection after StrictMode replay`,async()=>{
    for(const outcome of ['success','error','reject']) {
      const b=backend()
      b.api.storage={from:()=>Object.fromEntries(['upload','remove'].map(method=>[method,()=>new Promise((resolve,reject)=>b.requests.push({resolve,reject}))]))}
      const h=harness(b.api),hook=h.load(`src/hooks/${name}.ts`)[name]
      const action={useCopyCharacter:'copyCharacter',useSoftDeleteCharacter:'softDeleteCharacter',useUploadCharacterPortrait:'uploadCharacterPortrait',useRemoveCharacterPortrait:'removeCharacterPortrait'}[name]
      const result=h.render(hook,[])[action](other,{type:'image/png',size:1024})
      h.replayEffects();const writes=h.stateWriteCount()
      if(outcome==='reject')b.requests[0].reject(Error('offline'))
      else b.requests[0].resolve({data:round,error:outcome==='error'?{message:'denied'}:null})
      assert.equal(await result,name==='useCopyCharacter'?null:false)
      assert.equal(h.stateWriteCount(),writes);h.cleanup()
    }
  })
}

for(const switched of [false,true]) {
  test(`cleanup fix: portrait upload/delete reverse completion ${switched?'across character/account remount':'within the same page'} cannot restore an obsolete image`,async()=>{
    const storage=[];let reloads=0,clears=0
    const {b,h,root,resolveRead}=sheetPageSetup({
      '../hooks/useUploadCharacterPortrait':undefined,
      '../hooks/useRemoveCharacterPortrait':undefined,
      '../hooks/useCharacterPortrait':{useCharacterPortrait:()=>({portraitUrl:'blob:current',isLoading:false,error:null,reload:()=>reloads++,clearPortrait:()=>clears++,reconcile(){}})},
    })
    b.api.storage={from:()=>Object.fromEntries(['upload','remove'].map(method=>[method,()=>new Promise(resolve=>storage.push({method,resolve}))]))}
    await resolveRead()
    nodes(h.render()).find(n=>n.props?.className==='character-portrait-remove-trigger').props.onClick()
    // Keep both handlers to model already-dispatched actions; ordinary UI disables
    // overlapping operations, but completion ordering must still be harmless.
    const remove=nodes(h.render()).find(n=>n.props?.className==='character-portrait-remove-confirm').props.onClick
    const upload=nodes(h.render()).find(n=>n.type==='input'&&n.props.type==='file').props.onChange
    upload({target:{files:[{type:'image/png',size:1024}],value:'file'}})
    let next
    if(switched){
      h.cleanup()
      next=sheetPageSetup({
        '../auth/useAuth':{useAuth:()=>({user:{id:'next-user'}})},
        'react-router-dom':{useParams:()=>({characterId:round}),useLocation:()=>({}),useNavigate:()=>()=>{},Link:'Link'},
        '../hooks/useRemoveCharacterPortrait':undefined,
        '../hooks/useCharacterPortrait':{useCharacterPortrait:()=>({portraitUrl:'blob:next',isLoading:false,error:null,reload:()=>reloads++,clearPortrait:()=>clears++,reconcile(){}})},
      })
      next.b.api.storage=b.api.storage
      assert.notEqual(next.root.key,root.key)
      await next.resolveRead(sheetData({id:round,owner_user_id:'next-user'}))
      nodes(next.h.render()).find(n=>n.props?.className==='character-portrait-remove-trigger').props.onClick()
      nodes(next.h.render()).find(n=>n.props?.className==='character-portrait-remove-confirm').props.onClick()
    }else remove()
    assert.equal(storage.length,2)
    storage[1].resolve({error:null});await settle();assert.equal(clears,1)
    const writes=h.stateWriteCount(),nextWrites=next?.h.stateWriteCount()
    storage[0].resolve({error:null});await settle()
    assert.equal(reloads,0);assert.equal(clears,1)
    if(switched){assert.equal(h.stateWriteCount(),writes);assert.equal(next.h.stateWriteCount(),nextWrites);next.h.cleanup()}
    else h.cleanup()
  })
}

test('cleanup fix: profile save from account A cannot clear account B draft or display success',async()=>{
  let profile=profileData(),finish
  const save=new Promise(resolve=>{finish=resolve})
  const h=harness({}, {}, {
    '../auth/useAuth':{useAuth:()=>({user:{id:profile.id}})},
    '../hooks/useProfile':{useProfile:()=>({profile,isLoading:false,isSaving:false,updateDisplayName:()=>save})},
    '../components/EmailChangeForm':{default:'EmailChangeForm'},
    '../components/PasswordChangeForm':{default:'PasswordChangeForm'},
  })
  const Page=h.load('src/pages/ProfilePage.tsx').default
  const input=()=>nodes(h.render()).find(n=>n.props?.id==='display-name')
  h.render(Page,[]);input().props.onChange({target:{value:'Draft A'}})
  const submitted=nodes(h.render()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}})
  profile=profileData({id:'next-user',display_name:'Account B'})
  input().props.onChange({target:{value:'Draft B'}})
  const writes=h.stateWriteCount();finish(profileData({display_name:'Draft A'}));await submitted
  assert.equal(h.stateWriteCount(),writes);assert.equal(input().props.value,'Draft B')
  assert.doesNotMatch(textOf(h.render()),/Profil wurde gespeichert/);h.cleanup()
})

for(const departed of [false,true]) {
  test(`cleanup fix: shared provider save updates global profile with ProfilePage ${departed?'unmounted':'still open'}`,async()=>{
    const provider=profileSetup()
    provider.b.requests[0].resolve({data:profileData(),error:null});await settle()
    const h=harness({}, {}, {
      '../auth/useAuth':{useAuth:()=>provider.auth},
      '../hooks/useProfile':{useProfile:()=>provider.render()},
      '../components/EmailChangeForm':{default:'EmailChangeForm'},
      '../components/PasswordChangeForm':{default:'PasswordChangeForm'},
    })
    const Page=h.load('src/pages/ProfilePage.tsx').default
    h.render(Page,[])
    nodes(h.render()).find(n=>n.props?.id==='display-name').props.onChange({target:{value:'Saved'}})
    const submitted=nodes(h.render()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}})
    const write=provider.b.requests.at(-1)
    if(departed)h.cleanup()
    const writes=h.stateWriteCount()
    write.resolve({data:profileData({display_name:'Saved'}),error:null});await submitted
    assert.equal(provider.render().profile.display_name,'Saved')
    if(departed)assert.equal(h.stateWriteCount(),writes)
    else{
      assert.match(textOf(h.render()),/Profil wurde gespeichert/)
      assert.equal(nodes(h.render()).find(n=>n.props?.id==='display-name').props.value,'Saved');h.cleanup()
    }
    provider.h.cleanup()
  })
}

// Play mode: exercise the shell with the existing lifecycle harness.
const emptyChat=()=>({messages:[],initialLatestSeq:0,isLoading:false,isLoadingOlder:false,hasOlder:false,accessDenied:false,error:null,reload(){},loadOlder(){}})
const emptyComposer=()=>({text:'',isSending:false,error:null,setText(){},send(){},sendDice(){},sendReroll(){}})
function playSetup() {
  const b=backend(), clock=browserClock()
  let roundId=round, account=user, desktop=true
  clock.window.matchMedia=()=>({matches:desktop,addEventListener(){},removeEventListener(){}})
  const h=harness(b.api,clock,{
    'react-router-dom':{useParams:()=>({roundId}),Link:'Link'},
    '../auth/useAuth':{useAuth:()=>({user:account?{id:account}:null})},
    '../components/PlayModeHeader':{default:'PlayModeHeader'},
    '../components/PlayMainContent':{default:'PlayMainContent'},
    '../components/PlayChatPanel':{default:'PlayChatPanel'},
    '../hooks/useRoundMessages':{useRoundMessages:emptyChat},
    '../hooks/useRoundCharacters':{useRoundCharacters:()=>({characters:[],isLoading:false,reload(){}})},
  })
  const Page=h.load('src/pages/RoundPlayPage.tsx').default
  h.render(Page,[])
  return {b,h,clock,Page,setRound:id=>{roundId=id},setAccount:id=>{account=id},setDesktop:value=>{desktop=value}}
}

test('play access uses normal membership reads, scoped refresh, locks and membership loss',async()=>{
  const {b,h,clock}=playSetup()
  assert.equal(b.requests.length,2)
  assert.equal(b.requests[0].table,'round_memberships')
  assert.equal(b.requests[0].user_id,user)
  assert.equal(b.requests[0].round_id,round)
  b.requests[0].resolve({data:roundData('player'),error:null})
  b.requests[1].resolve({data:[member()],error:null});await tick()
  assert.equal(h.render().props.round.id,round)
  assert.deepEqual(b.channels.map(c=>c.config.table),['rounds','round_memberships','characters'])
  b.channels[0].cb();clock.advance()
  b.requests[2].resolve({data:roundData('player',{locked_at:'2026-09-14'}),error:null})
  b.requests[3].resolve({data:[member()],error:null});await tick()
  assert.equal(h.render().props.round.locked_at,'2026-09-14','lock keeps the same read access as round details')
  clock.window.dispatchEvent(new Event('focus'));clock.advance()
  b.requests[4].reject(Error('network'))
  b.requests[5].resolve({data:[],error:null});await tick()
  assert.match(textOf(h.render()),/nicht verfügbar/)
  assert.equal(b.removals.length,1,'remove the speaker channel, but retain access recovery subscriptions')
  b.channels[0].cb();clock.advance()
  b.requests[6].resolve({data:roundData('player'),error:null})
  b.requests[7].resolve({data:[member()],error:null});await tick()
  assert.equal(h.render().props.round.id,round)
  h.cleanup()
  assert.equal(b.removals.length,4)
})

test('play navigation changes round/account keys, rejects stale results and hides content on logout',async()=>{
  const {b,h,Page,setRound,setAccount}=playSetup()
  b.requests[0].resolve({data:roundData(),error:null})
  b.requests[1].resolve({data:[member()],error:null});await tick()
  const initial=h.render()
  setRound(other)
  assert.match(textOf(h.render(Page,[])),/geladen/)
  assert.equal(b.requests[2].round_id,other)
  b.requests[2].resolve({data:roundData('player',{id:other,name:'Andere Runde'}),error:null})
  b.requests[3].resolve({data:[member()],error:null});await tick()
  const next=h.render()
  assert.equal(next.props.round.id,other)
  assert.notEqual(next.key,initial.key)
  setAccount('admin-without-membership');h.render()
  b.requests[4].resolve({data:null,error:null})
  b.requests[5].resolve({data:[],error:null});await tick()
  assert.match(textOf(h.render()),/nicht verfügbar/)
  setAccount(undefined)
  assert.match(textOf(h.render()),/nicht verfügbar/)
  assert.equal(b.requests[4].signal.aborted,true)
  h.cleanup()
})

test('play tabs and desktop/mobile chat states remain independent',async()=>{
  const setup=playSetup(),{b,h,setDesktop}=setup
  b.requests[0].resolve({data:roundData(),error:null})
  b.requests[1].resolve({data:[member()],error:null});await tick()
  const root=h.render()
  const shell=harness({},setup.clock,{
    'react-router-dom':{Link:'Link'},
    '../auth/useAuth':{useAuth:()=>({})},
    '../components/PlayModeHeader':{default:'PlayModeHeader'},
    '../components/PlayMainContent':{default:'PlayMainContent'},
    '../components/PlayChatPanel':{default:'PlayChatPanel'},
  })
  const header=tree=>nodes(tree).find(n=>n.type==='PlayModeHeader').props
  const panel=tree=>nodes(tree).find(n=>n.type==='PlayChatPanel').props
  const Shell=shell.load('src/pages/RoundPlayPage.tsx').RoundPlayShell
  let tree=shell.render(Shell,[root.props])
  assert.equal(header(tree).roundId,round)
  assert.equal(panel(tree).isOpen,true)
  for(const tab of ['character','notes','table']) {
    header(tree).onTabChange(tab);tree=shell.render()
    assert.equal(nodes(tree).find(n=>n.type==='PlayMainContent').props.activeTab,tab)
    assert.equal(panel(tree).isOpen,true)
  }
  header(tree).onTabChange('notes');header(tree).onChatToggle();tree=shell.render()
  assert.equal(panel(tree).isOpen,false)
  assert.equal(header(tree).activeTab,'notes')
  assert.equal(nodes(tree).find(n=>n.props?.className==='play-workspace').props['data-chat-open'],false)
  header(tree).onChatToggle();tree=shell.render();assert.equal(panel(tree).isOpen,true)
  setDesktop(false);tree=shell.render()
  assert.equal(panel(tree).isDesktop,false)
  assert.equal(panel(tree).isOpen,false)
  header(tree).onChatToggle();tree=shell.render();assert.equal(panel(tree).isOpen,true)
  panel(tree).onClose();tree=shell.render()
  assert.equal(panel(tree).isOpen,false)
  assert.equal(header(tree).activeTab,'notes')
  shell.cleanup();h.cleanup()
})

test('play header links to current round and supports arrow/Home/End tab navigation',()=>{
  const h=harness({}, {}, {'react-router-dom':{Link:'Link'}})
  const Header=h.load('src/components/PlayModeHeader.tsx').default
  let selected='table',focused
  const props={roundId:other,roundName:'Andere Runde',activeTab:'table',onTabChange:tab=>{selected=tab},isChatOpen:true,onChatToggle(){}}
  const tree=h.render(Header,[props])
  assert.equal(nodes(tree).find(n=>n.type==='Link').props.to,`/app/rounds/${other}`)
  const tabs=nodes(tree).filter(n=>n.props?.role==='tab')
  tabs.forEach((tab,i)=>tab.props.ref({focus(){focused=i}}))
  assert.deepEqual(tabs.map(t=>t.props.tabIndex),[0,-1,-1])
  for(const [key,tab,index] of [['ArrowLeft','notes',2],['ArrowRight','character',1],['End','notes',2],['Home','table',0]]) {
    tabs[0].props.onKeyDown({key,preventDefault(){}})
    assert.equal(selected,tab);assert.equal(focused,index)
  }
  h.cleanup()
})

test('mobile chat is modal, closes with Escape/backdrop and restores body scroll; composer is disabled',()=>{
  const document={body:{style:{overflow:'auto'}}}
  const h=harness({}, {document})
  const Panel=h.load('src/components/PlayChatPanel.tsx').default
  let closes=0,opens=0,requests=0
  const props={isDesktop:false,isOpen:false,onClose:()=>requests++,chat:emptyChat(),composer:emptyComposer(),disabledReason:'Wähle zuerst einen aktiven Charakter.',speakerName:null,unreadCount:0,onRead(){}}
  let tree=h.render(Panel,[props])
  tree.props.ref.current={showModal(){opens++},close(){closes++}}
  tree=h.render(Panel,[{...props,isOpen:true}])
  assert.equal(opens,1);assert.equal(document.body.style.overflow,'hidden')
  assert.equal(nodes(tree).find(n=>n.type==='textarea').props.disabled,true)
  assert.equal(nodes(tree).find(n=>n.type==='button'&&textOf(n)==='Senden').props.disabled,true)
  tree.props.onCancel({preventDefault(){}});assert.equal(requests,1)
  const backdrop={};tree.props.onClick({target:backdrop,currentTarget:backdrop});assert.equal(requests,2)
  h.render(Panel,[props]);assert.equal(closes,1);assert.equal(document.body.style.overflow,'auto')
  h.cleanup()
})

test('play route remains inside RequireAuth and AppLayout, without an admin access path',()=>{
  const source=readFileSync('src/App.tsx','utf8')
  const overrides={'react-router-dom':{Route:'Route',Routes:'Routes'}}
  for(const [,name,path] of source.matchAll(/import (\w+) from '([^']+)'/g)) overrides[path]={default:name}
  const h=harness({}, {},overrides)
  const App=h.load('src/App.tsx').default
  const tree=h.render(App,[])
  const auth=nodes(tree).find(n=>n.type==='Route'&&n.props.element?.type==='RequireAuth')
  const layout=nodes(auth).find(n=>n.type==='Route'&&n.props.path==='/app')
  const play=nodes(layout).find(n=>n.type==='Route'&&n.props.path==='rounds/:roundId/play')
  assert.equal(play.props.element.type,'RoundPlayPage')
  assert.ok(layout.props.children.includes(play),'play route is a direct child of the normal app layout')
  const guard=harness({}, {},{
    'react-router-dom':{Navigate:'Navigate',Outlet:'Outlet',useLocation:()=>({pathname:`/app/rounds/${round}/play`})},
    '../auth/useAuth':{useAuth:()=>({session:null,isLoading:false})},
    '../components/AuthLoadingScreen':{default:'AuthLoadingScreen'},
  })
  const RequireAuth=guard.load('src/routes/RequireAuth.tsx').default
  const redirected=guard.render(RequireAuth,[])
  assert.equal(redirected.props.to,'/login')
  assert.equal(redirected.props.state.from.pathname,`/app/rounds/${round}/play`)
  guard.cleanup();h.cleanup()
})

// Phase 3.1: real hooks against controlled authorized query responses.
const chatMessage=(seq,overrides={})=>({id:`message-${seq}`,round_id:round,round_seq:seq,author_user_id:user,
  recipient_user_id:null,character_id:other,speaker_kind:'character',speaker_name_snapshot:'Astrid',kind:'character_message',
  body:`Nachricht ${seq}`,client_request_id:`request-${seq}`,created_at:'2026-09-14T10:00:00Z',...overrides})
const diceMessage=(seq,overrides={})=>chatMessage(seq,{kind:'dice_roll',body:null,dice_roll:{message_id:`message-${seq}`,
  dice_count:3,dice_sides:6,modifier:-2,results:[4,1,6],raw_total:11,total:9},...overrides})
const chatBatch=(start,end)=>Array.from({length:end-start+1},(_,i)=>chatMessage(start+i))

test('round-message decoder validates text variants and preserves the private assignment identity',()=>{
  const h=harness({}),{decodeRoundMessage}=h.load('src/types/roundMessage.ts')
  const character=decodeRoundMessage(chatMessage(1))
  assert.equal(character.kind,'character_message');assert.equal(character.body,'Nachricht 1')
  const publicSystem=decodeRoundMessage(chatMessage(2,{kind:'system_message',speaker_kind:'system',speaker_name_snapshot:'System',
    author_user_id:null,recipient_user_id:null,character_id:null,body:'Die Runde wurde pausiert.'}))
  assert.equal(publicSystem.kind,'system_message');assert.equal(publicSystem.recipient_user_id,null);assert.equal(publicSystem.character_id,null)
  const system=decodeRoundMessage(chatMessage(3,{kind:'system_message',speaker_kind:'system',speaker_name_snapshot:'System',
    author_user_id:null,recipient_user_id:user,character_id:other,body:'Zugewiesen'}))
  assert.equal(system.kind,'system_message');assert.equal(system.recipient_user_id,user);assert.equal(system.character_id,other)
  assert.equal(decodeRoundMessage(chatMessage(4,{kind:'character_message',body:null})),null)
  assert.equal(decodeRoundMessage(chatMessage(5,{kind:'system_message',speaker_kind:'character'})),null)
  assert.equal(decodeRoundMessage(chatMessage(6,{kind:'unknown_message'})),null)
  h.cleanup()
})

test('round-message decoder normalizes RPC object and PostgREST relation-array dice forms identically',()=>{
  const h=harness({}),{decodeRoundMessage,formatDiceExpression}=h.load('src/types/roundMessage.ts')
  const rpc=diceMessage(1),embedded={...rpc,dice_roll:[rpc.dice_roll]}
  const decodedRpc=decodeRoundMessage(rpc),decodedEmbedded=decodeRoundMessage(embedded)
  assert.deepEqual(JSON.parse(JSON.stringify(decodedRpc)),JSON.parse(JSON.stringify(decodedEmbedded)))
  assert.deepEqual(Array.from(decodedRpc.dice_roll.results),[4,1,6])
  assert.equal(formatDiceExpression(decodedRpc.dice_roll),'3d6-2')
  assert.equal(formatDiceExpression({...decodedRpc.dice_roll,modifier:0}),'3d6')
  assert.equal(formatDiceExpression({...decodedRpc.dice_roll,modifier:3}),'3d6+3')
  h.cleanup()
})

test('round-message decoder retains a corrupt dice parent with a defined unavailable-detail state',()=>{
  const h=harness({}),{decodeRoundMessage}=h.load('src/types/roundMessage.ts')
  for(const raw of [
    diceMessage(1,{dice_roll:null}),
    diceMessage(2,{dice_roll:{message_id:'message-2',dice_count:2,dice_sides:6,modifier:0,results:'4,1',raw_total:5,total:5}}),
    diceMessage(3,{dice_roll:{message_id:'message-3',dice_count:2,dice_sides:6,modifier:0,results:[4,1],raw_total:5}}),
  ]) {
    const decoded=decodeRoundMessage(raw)
    assert.equal(decoded.kind,'dice_roll');assert.equal(decoded.body,null);assert.equal(decoded.dice_roll,null)
  }
  assert.equal(decodeRoundMessage(diceMessage(4,{body:'must be null'})),null)
  h.cleanup()
})
function chatSetup() {
  const b=backend(),clock=browserClock(),h=harness(b.api,clock)
  const hook=h.load('src/hooks/useRoundMessages.ts').useRoundMessages
  h.render(hook,[round,user])
  return {b,clock,h,hook}
}
async function authorize(request) {request.resolve({data:true,error:null});await settle()}
async function initialChat(fixture,batch=chatBatch(51,100).reverse()) {
  await authorize(fixture.b.requests.at(-1))
  fixture.b.requests.at(-1).resolve({data:batch,error:null});await settle()
  return fixture.h.render()
}
async function deltaChat(fixture,batch) {
  await authorize(fixture.b.requests.at(-1))
  fixture.b.requests.at(-1).resolve({data:batch,error:null});await settle()
  return fixture.h.render()
}

test('chat initial load requests latest 50, orders chronologically, and paginates by exclusive oldest cursor',async()=>{
  const f=chatSetup(),{b,h}=f
  assert.equal(b.requests[0].rpc,'can_read_round_messages')
  await authorize(b.requests[0])
  assert.equal(b.requests[1].table,'round_messages')
  assert.match(b.requests[1].fields,/(?:^|,)recipient_user_id(?:,|$)/)
  assert.match(b.requests[1].fields,/dice_roll:round_message_dice_rolls\(message_id,dice_count,dice_sides,modifier,results,raw_total,total\)/)
  assert.doesNotMatch(b.requests[1].fields,/!inner/)
  const fields=b.requests[1].fields
  assert.equal(b.requests[1].round_id,round)
  assert.equal(b.requests[1].limit,50)
  assert.deepEqual(b.requests[1].order,{key:'round_seq',ascending:false})
  b.requests[1].resolve({data:chatBatch(51,100).reverse(),error:null});await settle()
  assert.deepEqual(Array.from(h.render().messages,m=>m.round_seq),chatBatch(51,100).map(m=>m.round_seq))
  assert.equal(h.render().initialLatestSeq,100)
  h.render().loadOlder();h.render().loadOlder();assert.equal(b.requests.length,3)
  await authorize(b.requests[2]);assert.deepEqual(b.requests[3].lt,{key:'round_seq',value:51})
  assert.equal(b.requests[3].fields,fields)
  const olderBatch=chatBatch(1,50);olderBatch[24]=diceMessage(25)
  b.requests[3].resolve({data:olderBatch.reverse(),error:null});await settle()
  assert.equal(h.render().messages.length,100)
  assert.deepEqual(Array.from(h.render().messages.find(message=>message.round_seq===25).dice_roll.results),[4,1,6])
  h.render().reload();await authorize(b.requests[4])
  assert.deepEqual(b.requests[5].gt,{key:'round_seq',value:100},'older pages must not move the delta cursor')
  assert.equal(b.requests[5].fields,fields)
  b.requests[5].resolve({data:[],error:null});await settle();h.cleanup()
})

test('chat fetch decodes valid and corrupt dice details without a separate detail query',async()=>{
  const f=chatSetup(),{b,h}=f
  await initialChat(f,[diceMessage(1),diceMessage(2,{dice_roll:[]})])
  assert.equal(h.render().messages[0].kind,'dice_roll')
  assert.deepEqual(Array.from(h.render().messages[0].dice_roll.results),[4,1,6])
  assert.equal(h.render().messages[1].kind,'dice_roll');assert.equal(h.render().messages[1].dice_roll,null)
  assert.equal(b.requests.filter(request=>request.table==='round_message_dice_rolls').length,0)
  h.cleanup()
})

test('chat query preserves visible system-message fields without a client-side recipient filter',async()=>{
  const f=chatSetup(),{b,h}=f
  const system=chatMessage(1,{author_user_id:null,recipient_user_id:user,character_id:other,
    speaker_kind:'system',speaker_name_snapshot:'System',kind:'system_message',
    body:'Dir wurde der Charakter Elin Rosenqvist zugewiesen.'})
  await initialChat(f,[system])
  assert.deepEqual({...h.render().messages[0]},system)
  const query=b.requests[1]
  assert.match(query.fields,/(?:^|,)kind(?:,|$)/)
  assert.match(query.fields,/(?:^|,)speaker_kind(?:,|$)/)
  assert.match(query.fields,/(?:^|,)recipient_user_id(?:,|$)/)
  assert.equal(query.recipient_user_id,undefined)
  h.cleanup()
})

test('chat keeps text, system and speaker rendering while valid dice use disclosure and corrupt dice use fallback',()=>{
  const h=harness({}, {document:{body:{style:{overflow:''}}}})
  const panelModule=h.load('src/components/PlayChatPanel.tsx'),Panel=panelModule.default,View=panelModule.DiceRollMessageView
  const messages=[
    chatMessage(1),
    chatMessage(2,{author_user_id:null,recipient_user_id:user,speaker_kind:'system',
      speaker_name_snapshot:'System',kind:'system_message',body:'Dir wurde der Charakter Elin Rosenqvist zugewiesen.'}),
    chatMessage(3,{speaker_kind:'game_master',speaker_name_snapshot:'Spielleitung',character_id:null}),
    diceMessage(4),
    diceMessage(5,{dice_roll:null}),
    diceMessage(6,{speaker_kind:'game_master',speaker_name_snapshot:'Spielleitung',character_id:null}),
  ]
  const tree=h.render(Panel,[{isDesktop:true,isOpen:true,onClose(){},chat:{...emptyChat(),messages},
    composer:emptyComposer(),disabledReason:null,speakerName:'Astrid',unreadCount:0,onRead(){}}])
  const rendered=nodes(tree).filter(node=>node.type==='li'&&node.props.className?.includes('play-chat-message'))
  assert.equal(rendered.length,6)
  assert.deepEqual(rendered.map(node=>node.key),messages.map(message=>message.id))
  assert.equal(rendered[0].props.className,'play-chat-message')
  assert.equal(rendered[0].props['data-kind'],'character_message')
  assert.equal(rendered[2].props.className,'play-chat-message')
  assert.equal(rendered[2].props['data-speaker'],'game_master')
  assert.equal(rendered[1].props.className,'play-chat-message play-chat-message-system')
  assert.equal(rendered[1].props['data-kind'],'system_message')
  assert.equal(rendered[1].props['data-speaker'],'system')
  assert.match(textOf(rendered[1]),/^System.*Dir wurde der Charakter Elin Rosenqvist zugewiesen\./)
  assert.doesNotMatch(textOf(rendered[1]),/null|undefined/)
  assert.ok(nodes(rendered[1]).some(node=>node.type==='time'))
  assert.equal(rendered[3].props['data-kind'],'dice_roll')
  const validDiceView=nodes(rendered[3]).find(node=>node.type===View)
  assert.ok(validDiceView);assert.equal(validDiceView.props.rerollDisabled,false)
  assert.match(textOf(rendered[4]),/Würfelergebnis konnte nicht geladen werden\./)
  assert.doesNotMatch(textOf(rendered[4]),/null|undefined/)
  assert.equal(nodes(rendered[4]).some(node=>node.type===View||node.type==='details'),false)
  assert.equal(rendered[5].props['data-speaker'],'game_master')
  assert.match(textOf(nodes(rendered[5]).find(node=>node.props?.className==='play-chat-message-meta')),/^Spielleitung/)
  assert.ok(nodes(rendered[3]).some(node=>node.type==='time'))
  assert.ok(nodes(rendered[5]).some(node=>node.type==='time'))
  h.cleanup()
})

test('dice details are natively collapsed and expose stored values in order when opened',()=>{
  const h=harness({}),View=h.load('src/components/PlayChatPanel.tsx').DiceRollMessageView
  const details={message_id:'message-details',dice_count:3,dice_sides:6,modifier:2,
    results:[2,6,4],raw_total:12,total:14}
  let rerolls=0
  const tree=h.render(View,[{details,rerollDisabled:false,onReroll:()=>rerolls++}])
  const disclosure=nodes(tree).find(node=>node.type==='details')
  assert.ok(disclosure);assert.equal(disclosure.props.open,undefined,'native details start closed')
  assert.equal(textOf(nodes(disclosure).find(node=>node.type==='summary')),'3d6+2 → 14')
  assert.equal(textOf(nodes(disclosure).find(node=>node.props?.className==='play-chat-dice-results')),'2 · 6 · 4')
  assert.match(textOf(disclosure),/Rohsumme:12/)
  assert.match(textOf(disclosure),/Modifier:\+2/)
  assert.match(textOf(disclosure),/Gesamt:14/)
  const reroll=nodes(disclosure).find(node=>node.type==='button'&&textOf(node)==='↻ Nochmal würfeln')
  assert.ok(reroll);assert.equal(reroll.props.type,'button');assert.equal(reroll.props.disabled,false)
  assert.equal(nodes(disclosure).some(node=>node.type==='form'||node.type==='textarea'),false)
  disclosure.open=disclosure.props.open===true
  assert.equal(disclosure.open,false)
  disclosure.open=!disclosure.open
  assert.equal(disclosure.open,true,'native disclosure can be opened without React state')
  reroll.props.onClick();assert.equal(rerolls,1)
  h.cleanup()
})

test('dice details format negative and zero modifiers and render one die cleanly',()=>{
  const h=harness({}),View=h.load('src/components/PlayChatPanel.tsx').DiceRollMessageView
  for(const [modifier,expected] of [[-2,'-2'],[0,'0']]) {
    const details={message_id:`message-${modifier}`,dice_count:1,dice_sides:20,modifier,
      results:[14],raw_total:14,total:14+modifier}
    const tree=h.render(View,[{details,rerollDisabled:false,onReroll(){}}])
    assert.equal(textOf(nodes(tree).find(node=>node.type==='summary')),`1d20${modifier === -2 ? '-2' : ''} → ${14+modifier}`)
    const modifierRow=nodes(tree).find(node=>node.type==='div'&&textOf(nodes(node).find(child=>child.type==='dt'))==='Modifier:')
    assert.equal(textOf(nodes(modifierRow).find(node=>node.type==='dd')),expected)
    assert.equal(textOf(nodes(tree).find(node=>node.props?.className==='play-chat-dice-results')),'14')
    assert.doesNotMatch(textOf(modifierRow),/\+-2|\+0/)
  }
  h.cleanup()
})

test('dice details render every stored result without truncation',()=>{
  const h=harness({}),View=h.load('src/components/PlayChatPanel.tsx').DiceRollMessageView
  const results=Array.from({length:50},(_,index)=>index%6+1)
  const tree=h.render(View,[{details:{message_id:'message-many',dice_count:50,dice_sides:6,modifier:0,
    results,raw_total:173,total:173},rerollDisabled:false,onReroll(){}}])
  assert.equal(textOf(nodes(tree).find(node=>node.props?.className==='play-chat-dice-results')),results.join(' · '))
  h.cleanup()
})

test('reroll action is disclosure-local, uses stored parameters for foreign rolls and is absent from fallback',()=>{
  let rerolls=0,textSends=0,diceSends=0,draftEdits=0
  const h=harness({}, {document:{body:{style:{overflow:''}}}})
  const panelModule=h.load('src/components/PlayChatPanel.tsx'),Panel=panelModule.default,View=panelModule.DiceRollMessageView
  const foreign=diceMessage(7,{author_user_id:'another-user',character_id:'historical-character',
    speaker_name_snapshot:'blubb',dice_roll:{message_id:'message-7',dice_count:3,dice_sides:6,modifier:2,
      results:[2,6,4],raw_total:12,total:14}})
  const composer={...emptyComposer(),text:'Ich untersuche die Tür',send:()=>textSends++,sendDice:()=>diceSends++,
    setText:()=>draftEdits++,sendReroll:(source,dice)=>{rerolls++;assert.equal(source,foreign.id)
      assert.deepEqual({...dice},{diceCount:3,diceSides:6,modifier:2})}}
  const tree=h.render(Panel,[{isDesktop:true,isOpen:true,onClose(){},chat:{...emptyChat(),messages:[foreign,diceMessage(8,{dice_roll:null})]},
    composer,disabledReason:null,speakerName:'Astrid',unreadCount:0,onRead(){}}])
  const views=nodes(tree).filter(node=>node.type===View)
  assert.equal(views.length,1,'corrupt dice fallback has no reroll view')
  const disclosure=h.render(View,[views[0].props])
  assert.equal(disclosure.type,'details');assert.equal(disclosure.props.open,undefined)
  const button=nodes(disclosure).find(node=>node.type==='button'&&textOf(node)==='↻ Nochmal würfeln')
  assert.ok(button,'reroll is a child of the collapsed native disclosure')
  button.props.onClick()
  assert.equal(rerolls,1);assert.equal(textSends,0);assert.equal(diceSends,0);assert.equal(draftEdits,0)
  assert.equal(composer.text,'Ich untersuche die Tür')
  h.cleanup()
})

test('own visible 3d6+2 message rerolls through the shared structured dice send path',async()=>{
  const sender=sendSetup()
  sender.h.render().setText('Mein Chatdraft bleibt Text')
  const ownRoll=diceMessage(9,{author_user_id:user,character_id:other,speaker_name_snapshot:'Astrid',
    dice_roll:{message_id:'message-9',dice_count:3,dice_sides:6,modifier:2,
      results:[1,5,3],raw_total:9,total:11}})
  const ui=harness({}, {document:{body:{style:{overflow:''}}}})
  const panelModule=ui.load('src/components/PlayChatPanel.tsx'),Panel=panelModule.default,View=panelModule.DiceRollMessageView
  const panel=ui.render(Panel,[{isDesktop:true,isOpen:true,onClose(){},chat:{...emptyChat(),messages:[ownRoll]},
    composer:sender.h.render(),disabledReason:null,speakerName:'Astrid',unreadCount:0,onRead(){}}])
  const view=nodes(panel).find(node=>node.type===View)
  assert.ok(view,'own visible dice message renders its reroll disclosure')
  const disclosure=ui.render(View,[view.props])
  disclosure.open=disclosure.props.open===true
  assert.equal(disclosure.open,false)
  disclosure.open=true
  const button=nodes(disclosure).find(node=>node.type==='button'&&textOf(node)==='↻ Nochmal würfeln')
  const pending=button.props.onClick(),request=sender.b.requests[0]

  assert.equal(request.rpc,'send_round_dice_roll')
  assert.deepEqual(Object.keys(request.args).sort(),[
    'p_client_request_id','p_dice_count','p_dice_sides','p_expected_active_character_id','p_modifier','p_round_id',
  ])
  assert.equal(request.args.p_dice_count,3)
  assert.equal(request.args.p_dice_sides,6)
  assert.equal(request.args.p_modifier,2)
  assert.equal(request.args.p_expected_active_character_id,other)
  assert.equal('p_body' in request.args,false,'reroll does not synthesize a /r command')
  for(const field of ['results','raw_total','total']) assert.equal(field in request.args,false,field)
  request.resolve({data:confirmedDice(request),error:null})
  assert.equal(await pending,true)
  assert.equal(sender.h.render().text,'Mein Chatdraft bleibt Text')
  ui.cleanup();sender.h.cleanup()
})

test('chat uses exactly one INSERT-only channel and closes subscribe/initial race with a trailing authorized delta',async()=>{
  const f=chatSetup(),{b,h,clock}=f
  assert.equal(b.channels.length,1)
  const channel=b.channels[0]
  assert.equal(channel.bindings.filter(b=>b.kind==='postgres_changes').length,1)
  assert.deepEqual({...channel.config},{event:'INSERT',schema:'public',table:'round_messages',filter:`round_id=eq.${round}`})
  channel.status('SUBSCRIBED');clock.advance()
  await initialChat(f)
  assert.equal(b.requests.length,3)
  await authorize(b.requests[2]);assert.deepEqual(b.requests[3].gt,{key:'round_seq',value:100})
  b.requests[3].resolve({data:[chatMessage(101)],error:null});await settle()
  assert.equal(h.render().messages.at(-1).round_seq,101)
  channel.cb({new:chatMessage(999)});channel.cb({new:chatMessage(1000)});clock.advance()
  assert.equal(h.render().messages.at(-1).round_seq,101,'Realtime payload never enters chat state')
  await deltaChat(f,[diceMessage(102),diceMessage(102)])
  assert.equal(h.render().messages.length,52)
  assert.equal(h.render().messages.at(-1).kind,'dice_roll')
  assert.deepEqual(Array.from(h.render().messages.at(-1).dice_roll.results),[4,1,6])
  h.cleanup();assert.equal(b.removals.length,1)
})

test('chat reconnect/focus/visible/online coalesce and drain more than one delta page without losing cursor gaps',async()=>{
  const f=chatSetup(),{b,h,clock}=f;await initialChat(f)
  b.channels[0].status('SUBSCRIBED')
  clock.window.dispatchEvent(new Event('focus'));clock.window.dispatchEvent(new Event('online'))
  clock.document.dispatchEvent(new Event('visibilitychange'));clock.advance()
  assert.equal(b.requests.length,3)
  await deltaChat(f,chatBatch(101,150))
  assert.equal(b.requests.length,5,'a full delta page schedules the next page')
  await authorize(b.requests[4]);assert.deepEqual(b.requests[5].gt,{key:'round_seq',value:150})
  b.requests[5].resolve({data:chatBatch(151,153),error:null});await settle()
  assert.equal(h.render().messages.length,103)
  assert.equal(h.render().initialLatestSeq,100)
  clock.document.visibilityState='hidden';clock.window.dispatchEvent(new Event('focus'));clock.advance()
  assert.equal(b.requests.length,6)
  h.cleanup();assert.equal(clock.pending(),0)
})

test('chat preserves history on transient errors, but clears it on a confirmed denied read even with no new messages',async()=>{
  const f=chatSetup(),{b,h}=f;await initialChat(f)
  h.render().reload();b.requests.at(-1).reject(Error('offline'));await settle()
  assert.equal(h.render().messages.length,50);assert.ok(h.render().error)
  h.render().reload();b.requests.at(-1).resolve({data:false,error:null});await settle()
  assert.equal(h.render().messages.length,0);assert.equal(h.render().accessDenied,true)
  h.render().reload();await initialChat(f,[chatMessage(101)])
  assert.equal(h.render().accessDenied,false);assert.equal(h.render().messages.length,1)
  h.cleanup()
})

test('chat late older response cannot restore history after access loss, and later reauthorization uses a fresh initial page',async()=>{
  const f=chatSetup(),{b,h}=f;await initialChat(f)
  h.render().loadOlder();await authorize(b.requests.at(-1));const older=b.requests.at(-1)
  h.render().reload();b.requests.at(-1).resolve({data:false,error:null});await settle()
  older.resolve({data:chatBatch(1,50),error:null});await settle()
  assert.equal(h.render().messages.length,0);assert.equal(h.render().isLoadingOlder,false)
  h.render().reload();await initialChat(f,[chatMessage(101)])
  assert.equal(h.render().messages.length,1)
  h.cleanup()
})

for(const scope of ['round','account','logout','unmount','strict']) {
  test(`chat ${scope}: abort pending initial/older reads and ignore obsolete replies and channel callbacks`,async()=>{
    const f=chatSetup(),{b,h,hook,clock}=f;await initialChat(f)
    h.render().loadOlder();await authorize(b.requests.at(-1));const older=b.requests.at(-1)
    if(scope==='round')h.render(hook,[other,user])
    if(scope==='account')h.render(hook,[round,'next-user'])
    if(scope==='logout')h.render(hook,[round,undefined])
    if(scope==='unmount')h.cleanup()
    if(scope==='strict')h.replayEffects()
    assert.equal(older.signal.aborted,true)
    const writes=h.stateWriteCount(),requests=b.requests.length
    older.resolve({data:chatBatch(1,50),error:null});await settle()
    b.channels[0].cb();b.channels[0].status('SUBSCRIBED');clock.advance()
    assert.equal(h.stateWriteCount(),writes);assert.equal(b.requests.length,requests)
    if(scope!=='unmount'&&scope!=='strict')assert.equal(h.render().messages.length,0)
    h.cleanup()
  })
}

test('chat initial failure retries, empty round starts at zero, and events in a pending delta produce a trailing read',async()=>{
  const f=chatSetup(),{b,h,clock}=f
  b.requests[0].reject(Error('offline'));await settle();assert.ok(h.render().error)
  h.render().reload();await initialChat(f,[])
  assert.equal(h.render().initialLatestSeq,0)
  b.channels[0].cb();clock.advance()
  b.channels[0].cb();clock.advance()
  await deltaChat(f,[chatMessage(1)])
  assert.equal(b.requests.at(-1).rpc,'can_read_round_messages')
  await deltaChat(f,[chatMessage(2)])
  assert.deepEqual(Array.from(h.render().messages,m=>m.round_seq),[1,2]);h.cleanup()
})

function sendSetup(onSent=()=>{},onAccessRefresh=()=>{}) {
  const b=backend(),h=harness(b.api,{crypto:{randomUUID:()=>`request-${b.requests.length}`}})
  const hook=h.load('src/hooks/useSendRoundMessage.ts').useSendRoundMessage
  const args=[round,user,other,onSent,onAccessRefresh]
  h.render(hook,args)
  h.render().setText('Eine Nachricht\nmit zwei Zeilen')
  return {b,h,hook,args}
}
test('send derives only allowed RPC arguments, prevents double clicks, and clears text only after a confirmed receipt',async()=>{
  let synced=0
  const {b,h}=sendSetup(()=>synced++)
  const pending=h.render().send();h.render().send()
  assert.equal(b.requests.length,1);assert.equal(h.render().isSending,true)
  const request=b.requests[0]
  assert.deepEqual(Object.keys(request.args).sort(),['p_body','p_client_request_id','p_expected_active_character_id','p_round_id'])
  assert.equal(request.args.p_expected_active_character_id,other)
  assert.ok(h.render().text)
  request.resolve({data:chatMessage(104,{client_request_id:request.args.p_client_request_id}),error:null});await pending
  assert.equal(h.render().text,'');assert.equal(h.render().isSending,false);assert.equal(synced,1)
  h.cleanup()
})
test('send timeout preserves text and request ID; editing a failed draft creates a new request',async()=>{
  const {b,h}=sendSetup()
  const first=h.render().send();b.requests[0].reject(Error('timeout'));await first
  const text=h.render().text;assert.ok(h.render().error)
  const second=h.render().send()
  assert.equal(b.requests[1].args.p_client_request_id,b.requests[0].args.p_client_request_id)
  b.requests[1].resolve({data:null,error:{message:'temporary'}});await second
  assert.equal(h.render().text,text)
  h.render().setText('Neuer Text');const third=h.render().send()
  assert.notEqual(b.requests[2].args.p_client_request_id,b.requests[0].args.p_client_request_id)
  b.requests[2].resolve({data:null,error:{message:'CHAT_ROUND_ARCHIVED'}});await third
  assert.match(h.render().error,/Archivierte/);assert.equal(h.render().text,'Neuer Text')
  h.cleanup()
})
for(const mode of ['unmount','round','account','strict']) {
  test(`send ${mode}: a late success cannot clear a new draft or trigger synchronization`,async()=>{
    let synced=0
    const {b,h,hook,args}=sendSetup(()=>synced++)
    const pending=h.render().send()
    if(mode==='unmount')h.cleanup()
    if(mode==='round')h.render(hook,[other,...args.slice(1)])
    if(mode==='account')h.render(hook,[round,'next-user',...args.slice(2)])
    if(mode==='strict')h.replayEffects()
    const writes=h.stateWriteCount()
    b.requests[0].resolve({data:chatMessage(101,{client_request_id:b.requests[0].args.p_client_request_id}),error:null});await pending
    assert.equal(h.stateWriteCount(),writes);assert.equal(synced,0);assert.equal(b.requests[0].signal.aborted,true)
    h.cleanup()
  })
}

test('own send receipt does not leapfrog intervening messages in the read cursor',async()=>{
  const f=chatSetup();await initialChat(f)
  const {b,h}=sendSetup(f.h.render().reload)
  const sent=h.render().send();b.requests[0].resolve({data:chatMessage(105,{client_request_id:b.requests[0].args.p_client_request_id}),error:null});await sent
  await authorize(f.b.requests.at(-1))
  assert.deepEqual(f.b.requests.at(-1).gt,{key:'round_seq',value:100})
  f.b.requests.at(-1).resolve({data:chatBatch(101,105),error:null});await settle()
  assert.deepEqual(Array.from(f.h.render().messages.slice(-5),m=>m.round_seq),[101,102,103,104,105])
  h.cleanup();f.h.cleanup()
})

test('body limit counts Unicode characters, rejects whitespace, and treats markup as plain text',()=>{
  const h=harness({}),{isValidMessageBody}=h.load('src/types/roundMessage.ts')
  assert.equal(isValidMessageBody('\t\r\n\u00a0\u2003\ufeff'),false)
  assert.equal(isValidMessageBody('😀'.repeat(4000)),true)
  assert.equal(isValidMessageBody('a'.repeat(4001)),false)
  assert.equal(isValidMessageBody('<script>alert(1)</script> **text**'),true)
})

function shellSetup(overrides={}) {
  const clock=browserClock();let desktop=true
  clock.window.matchMedia=()=>({matches:desktop,addEventListener(){},removeEventListener(){}})
  const h=harness({},clock,{
    'react-router-dom':{Link:'Link'},'../auth/useAuth':{useAuth:()=>({})},
    '../components/PlayModeHeader':{default:'PlayModeHeader'},'../components/PlayMainContent':{default:'PlayMainContent'},
    '../components/PlayChatPanel':{default:'PlayChatPanel'},'../hooks/useSendRoundMessage':{useSendRoundMessage:emptyComposer},
  })
  const Shell=h.load('src/pages/RoundPlayPage.tsx').RoundPlayShell
  let props={round:roundData().round,userId:user,membership:member(),activeCharacter:{id:other,name:'Astrid'},ownCharacters:[{id:other,name:'Astrid'}],isSpeakerLoading:false,chat:emptyChat(),onAccessRefresh(){},...overrides}
  return {h,render:changes=>{props={...props,...changes};return h.render(Shell,[props])},setDesktop:value=>{desktop=value}}
}
test('composer gating covers missing/invalid active character, GM, archive, lock, and denied chat access',()=>{
  const f=shellSetup()
  const panel=tree=>nodes(tree).find(n=>n.type==='PlayChatPanel').props
  assert.equal(panel(f.render()).disabledReason,null)
  assert.match(panel(f.render({activeCharacter:undefined})).disabledReason,/aktiven Charakter/)
  assert.equal(panel(f.render({membership:{...member(user,'game_master'),active_character_id:null}})).disabledReason,null)
  assert.equal(panel(f.render()).speakerName,'Spielleitung')
  assert.match(panel(f.render({round:roundData('game_master',{status:'archived'}).round})).disabledReason,/Archivierte/)
  assert.match(panel(f.render({round:roundData('game_master',{locked_at:'now'}).round})).disabledReason,/gesperrt/)
  assert.match(panel(f.render({chat:{...emptyChat(),accessDenied:true}})).disabledReason,/keinen Zugriff/)
  f.h.cleanup()
})

test('collapsed/mobile chat shares messages and draft state, retains tabs and counts visible system/dice messages as unread',()=>{
  const f=shellSetup({chat:{...emptyChat(),messages:[chatMessage(50)],initialLatestSeq:50}})
  const header=tree=>nodes(tree).find(n=>n.type==='PlayModeHeader').props
  const panel=tree=>nodes(tree).find(n=>n.type==='PlayChatPanel').props
  let tree=f.render();header(tree).onTabChange('notes');header(tree).onChatToggle()
  const chat={...emptyChat(),messages:[chatMessage(50),chatMessage(51,{author_user_id:null,recipient_user_id:user,
    speaker_kind:'system',speaker_name_snapshot:'System',kind:'system_message'}),diceMessage(52)],initialLatestSeq:50}
  tree=f.render({chat});assert.equal(header(tree).unreadCount,2);assert.equal(panel(tree).isOpen,false)
  assert.equal(panel(tree).chat,chat);assert.equal(header(tree).activeTab,'notes')
  header(tree).onChatToggle();tree=f.render();assert.equal(panel(tree).chat,chat)
  panel(tree).onRead(52);tree=f.render();assert.equal(header(tree).unreadCount,0)
  f.setDesktop(false);tree=f.render();header(tree).onChatToggle();tree=f.render()
  assert.equal(panel(tree).isDesktop,false);assert.equal(panel(tree).chat,chat)
  assert.equal(header(tree).activeTab,'notes');f.h.cleanup()
})

test('chat checks access generation at merge time when an older response and denial complete in the same microtask turn',async()=>{
  const f=chatSetup(),{b,h}=f;await initialChat(f)
  h.render().loadOlder();await authorize(b.requests.at(-1));const older=b.requests.at(-1)
  h.render().reload();const access=b.requests.at(-1)
  older.resolve({data:chatBatch(1,50),error:null})
  access.resolve({data:false,error:null})
  await settle()
  assert.equal(h.render().accessDenied,true)
  assert.equal(h.render().messages.length,0)
  h.cleanup()
})

test('composer Enter sends once, Shift+Enter/IME retain multiline input, and disabled state blocks the submit handler',()=>{
  let sends=0
  const h=harness({}, {document:{body:{style:{overflow:''}}}})
  const Panel=h.load('src/components/PlayChatPanel.tsx').default
  const props={isDesktop:true,isOpen:true,onClose(){},chat:emptyChat(),composer:{...emptyComposer(),text:'Zeile eins\nZeile zwei',send:()=>sends++},disabledReason:null,speakerName:'Astrid',unreadCount:0,onRead(){}}
  let tree=h.render(Panel,[props])
  const input=nodes(tree).find(n=>n.type==='textarea')
  input.props.onKeyDown({key:'Enter',shiftKey:true,nativeEvent:{isComposing:false},preventDefault(){throw Error('Shift+Enter should remain native')}})
  input.props.onKeyDown({key:'Enter',shiftKey:false,nativeEvent:{isComposing:true},preventDefault(){throw Error('IME must not send')}})
  assert.equal(sends,0)
  input.props.onKeyDown({key:'Enter',shiftKey:false,nativeEvent:{isComposing:false},preventDefault(){}})
  assert.equal(sends,1)
  tree=h.render(Panel,[{...props,disabledReason:'Archiviert'}])
  nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}})
  assert.equal(sends,1);h.cleanup()
})

test('chat reconciles again on Postgres replication readiness after an earlier SUBSCRIBED delta has finished',async()=>{
  const f=chatSetup(),{b,h,clock}=f;await initialChat(f)
  assert.equal(b.channels[0].options.config.broadcast.replication_ready,true)
  const ready=b.channels[0].bindings.find(binding=>binding.kind==='system')
  b.channels[0].status('SUBSCRIBED');clock.advance();await deltaChat(f,[])
  const requests=b.requests.length
  ready.cb({extension:'postgres_changes',status:'error'});clock.advance();assert.equal(b.requests.length,requests)
  // A committed message between the first delta and listener readiness has no event.
  ready.cb({extension:'postgres_changes',status:'ok'});clock.advance()
  await deltaChat(f,[chatMessage(101)])
  assert.equal(h.render().messages.at(-1).round_seq,101)
  ready.cb({extension:'system',status:'ok'});clock.advance();await deltaChat(f,[chatMessage(102)])
  assert.equal(h.render().messages.at(-1).round_seq,102)
  h.cleanup();const after=b.requests.length
  ready.cb({extension:'system',status:'ok'});clock.advance();assert.equal(b.requests.length,after)
})

for(const desktop of [true,false]) {
  test(`chat UX: ${desktop?'desktop has no redundant close':'mobile retains close and Escape'} and successful send refocuses the enabled composer`,async()=>{
    const document={body:{style:{overflow:''}},activeElement:null}
    const h=harness({}, {document}),Panel=h.load('src/components/PlayChatPanel.tsx').default
    let finish,focuses=0,closes=0,text='Hello'
    const composer={...emptyComposer(),text,send:()=>new Promise(resolve=>{finish=resolve}),setText:value=>{text=value}}
    let props={isDesktop:desktop,isOpen:true,onClose:()=>closes++,chat:emptyChat(),composer,disabledReason:null,speakerName:'GM',unreadCount:0,onRead(){}}
    const render=changes=>{props={...props,...changes};return h.render(Panel,[props])}
    let tree=render()
    const field={disabled:true,focus(options){assert.equal(this.disabled,false);assert.equal(options.preventScroll,true);document.activeElement=this;focuses++}}
    const input=()=>nodes(tree).find(n=>n.type==='textarea')
    input().props.ref.current=field
    assert.equal(nodes(tree).filter(n=>n.type==='button'&&textOf(n)==='Chat schließen').length,desktop?0:1)
    if(!desktop){
      nodes(tree).find(n=>n.type==='button'&&textOf(n)==='Chat schließen').props.onClick()
      tree.props.onCancel({preventDefault(){}});assert.equal(closes,2)
    }
    nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}})
    tree=render({composer:{...composer,isSending:true}})
    finish(true);await settle();tree=render();assert.equal(focuses,0,'wait for the enabled DOM commit')
    field.disabled=false;tree=render({composer:{...composer,text:'',isSending:false}})
    assert.equal(focuses,1);assert.equal(input().props.value,'');assert.equal(document.activeElement,field)
    input().props.onChange({target:{value:'Next message'}});assert.equal(text,'Next message')
    tree=render({chat:{...emptyChat(),messages:[chatMessage(1)]}});assert.equal(focuses,1,'later renders must not refocus')
    h.cleanup()
  })
}

for(const change of ['close','close-reopen','viewport','unmount']) {
  test(`chat UX: pending send cannot steal focus after ${change}`,async()=>{
    const document={body:{style:{overflow:''}},activeElement:null}
    const h=harness({}, {document}),Panel=h.load('src/components/PlayChatPanel.tsx').default
    let finish,focuses=0
    const props={isDesktop:true,isOpen:true,onClose(){},chat:emptyChat(),composer:{...emptyComposer(),text:'Hello',send:()=>new Promise(resolve=>{finish=resolve})},disabledReason:null,speakerName:'GM',unreadCount:0,onRead(){}}
    const tree=h.render(Panel,[props])
    nodes(tree).find(n=>n.type==='textarea').props.ref.current={focus(){focuses++}}
    nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}})
    if(change==='unmount')h.cleanup()
    else if(change==='viewport')h.render(Panel,[{...props,isDesktop:false}])
    else {h.render(Panel,[{...props,isOpen:false}]);if(change==='close-reopen')h.render(Panel,[props])}
    const writes=h.stateWriteCount();finish(true);await settle()
    assert.equal(h.stateWriteCount(),writes);assert.equal(focuses,0);h.cleanup()
  })
}

for(const moved of [false,true]) {
  test(`chat UX: failed send preserves text and ${moved?'respects focus moved elsewhere':'restores input focus lost while disabled'}`,async()=>{
    const document={body:{style:{overflow:''}},activeElement:null}
    const h=harness({}, {document}),Panel=h.load('src/components/PlayChatPanel.tsx').default
    let finish,focuses=0
    const field={focus(){document.activeElement=this;focuses++}}
    const props={isDesktop:true,isOpen:true,onClose(){},chat:emptyChat(),composer:{...emptyComposer(),text:'Keep this',send:()=>new Promise(resolve=>{finish=resolve})},disabledReason:null,speakerName:'GM',unreadCount:0,onRead(){}}
    let tree=h.render(Panel,[props]);nodes(tree).find(n=>n.type==='textarea').props.ref.current=field
    document.activeElement=field
    nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}})
    document.activeElement=moved?{otherButton:true}:document.body
    finish(false);await settle()
    tree=h.render(Panel,[{...props,composer:{...props.composer,error:'Offline'}}])
    assert.equal(nodes(tree).find(n=>n.type==='textarea').props.value,'Keep this')
    assert.match(textOf(tree),/Offline/);assert.equal(focuses,moved?0:1);h.cleanup()
  })
}

// Phase 3.2c: real sender hook bound to the shell's mode state.
function gmSenderSetup(changes={}) {
  const b=backend(),clock=browserClock()
  clock.window.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}})
  const h=harness(b.api,{...clock,crypto:{randomUUID:()=>`gm-request-${b.requests.length}`}}, {
    'react-router-dom':{Link:'Link'},'../auth/useAuth':{useAuth:()=>({})},
    '../components/PlayModeHeader':{default:'PlayModeHeader'},'../components/PlayMainContent':{default:'PlayMainContent'},
    '../components/PlayChatPanel':{default:'PlayChatPanel'},
  })
  const Shell=h.load('src/pages/RoundPlayPage.tsx').RoundPlayShell
  let props={round:roundData('game_master').round,userId:user,membership:{...member(user,'game_master'),active_character_id:other},
    activeCharacter:{id:other,name:'Elin'},ownCharacters:[{id:other,name:'Elin'},{id:'B',name:'Birgit'}],
    isSpeakerLoading:false,chat:emptyChat(),onAccessRefresh(){},...changes}
  const render=next=>{props={...props,...next};return nodes(h.render(Shell,[props])).find(n=>n.type==='PlayChatPanel').props}
  render()
  return {b,h,render}
}
function canonicalSpeaker(f,id) {
  return f.render({membership:{...member(user,'game_master'),active_character_id:id},
    activeCharacter:id ? {id,name:id===other?'Elin':'Birgit'} : undefined})
}
async function chooseSpeaker(f,id) {
  const operation=f.render().speakerSelection.onChange(id)
  const request=f.b.requests.at(-1)
  assert.equal(request.rpc,'set_active_character')
  assert.deepEqual({...request.args},{p_round_id:round,p_character_id:id})
  request.resolve({data:null,error:null})
  canonicalSpeaker(f,id)
  await operation
  return f.render()
}
test('active-character writes are round-scoped for both character selection and GM narration',async()=>{
  const b=backend(),h=harness(b.api),hook=h.load('src/hooks/useSetActiveCharacter.ts').useSetActiveCharacter
  h.render(hook,[])
  let pending=h.render().setActiveCharacter(round,other)
  assert.equal(b.requests[0].rpc,'set_active_character')
  assert.deepEqual({...b.requests[0].args},{p_round_id:round,p_character_id:other})
  b.requests[0].resolve({data:null,error:null});assert.equal(await pending,true)
  h.render()
  pending=h.render().setActiveCharacter(round,null)
  assert.deepEqual({...b.requests[1].args},{p_round_id:round,p_character_id:null})
  b.requests[1].resolve({data:null,error:null});assert.equal(await pending,true)
  h.render()
  assert.equal(await h.render().setActiveCharacter('',other),false)
  assert.equal(b.requests.length,2)
  h.cleanup()
})
async function confirmSend(f,pending) {
  const request=f.b.requests.at(-1)
  request.resolve({data:chatMessage(1,{client_request_id:request.args.p_client_request_id}),error:null})
  assert.equal(await pending,true)
}
test('GM sender persists both directions and sends exactly the existing four chat RPC parameters',async()=>{
  const f=gmSenderSetup()
  assert.equal(f.render().speakerSelection.characterId,other);assert.equal(f.render().speakerName,'Elin')
  for(const id of [other,null,other]) {
    if(f.render().speakerSelection.characterId!==id) await chooseSpeaker(f,id)
    f.render().composer.setText('Gleicher Text')
    const pending=f.render().composer.send(),request=f.b.requests.at(-1)
    assert.deepEqual(Object.keys(request.args).sort(),['p_body','p_client_request_id','p_expected_active_character_id','p_round_id'])
    assert.equal(request.args.p_expected_active_character_id,id)
    await confirmSend(f,pending)
  }
  assert.equal(new Set(f.b.requests.filter(r=>r.rpc==='send_round_message').map(r=>r.args.p_client_request_id)).size,3)
  f.h.cleanup()
})
test('GM sender waits for character resolution and adopts canonical ID changes and renames',()=>{
  const f=gmSenderSetup({activeCharacter:undefined,ownCharacters:[],isSpeakerLoading:true})
  assert.ok(f.render().disabledReason)
  let panel=f.render({activeCharacter:{id:other,name:'Elin'},ownCharacters:[{id:other,name:'Elin'}],isSpeakerLoading:false})
  assert.equal(panel.speakerSelection.characterId,other)
  panel=f.render({activeCharacter:undefined,isSpeakerLoading:true})
  assert.ok(panel.disabledReason)
  panel=f.render({activeCharacter:{id:'B',name:'Birgit'},ownCharacters:[{id:'B',name:'Birgit'}],isSpeakerLoading:false,
    membership:{...member(user,'game_master'),active_character_id:'B'}})
  assert.equal(panel.speakerSelection.characterId,'B');assert.equal(panel.speakerName,'Birgit')
  panel=f.render({ownCharacters:[{id:'B',name:'Birgit Neu'}]})
  assert.equal(panel.speakerName,'Birgit Neu')
  panel=canonicalSpeaker(f,null)
  assert.equal(panel.speakerSelection.characterId,null);assert.equal(panel.disabledReason,null)
  panel=canonicalSpeaker(f,'B')
  assert.equal(panel.speakerSelection.characterId,'B')
  f.h.cleanup()
})
test('GM without characters narrates; players have no selection and use only their active character',async()=>{
  const f=gmSenderSetup({ownCharacters:[],activeCharacter:undefined,membership:{...member(user,'game_master'),active_character_id:null}})
  assert.equal(f.render().speakerSelection.characters.length,0)
  assert.equal(f.render().speakerSelection.characterId,null)
  f.render().composer.setText('Erzählung');await confirmSend(f,f.render().composer.send())
  assert.equal(f.b.requests[0].args.p_expected_active_character_id,null)
  let panel=f.render({membership:member(),activeCharacter:{id:other,name:'Sven'}})
  assert.equal(panel.speakerSelection,undefined);assert.equal(panel.speakerName,'Sven')
  panel.composer.setText('Spielertext');await confirmSend(f,f.render().composer.send())
  assert.equal(f.b.requests[1].args.p_expected_active_character_id,other)
  panel=f.render({activeCharacter:undefined});assert.match(panel.disabledReason,/aktiven Charakter/)
  f.h.cleanup()
})
test('GM narration round trip retains all own character options through canonical NULL and remount',async()=>{
  const f=gmSenderSetup()
  let panel=await chooseSpeaker(f,null)
  assert.equal(panel.speakerSelection.characterId,null)
  assert.equal(panel.speakerName,'Spielleitung')
  assert.equal(panel.speakerSelection.characters.length,2)
  panel=await chooseSpeaker(f,'B')
  assert.equal(panel.speakerSelection.characterId,'B')
  assert.equal(panel.speakerName,'Birgit')
  f.h.cleanup()
  for(const id of [null,other]) {
    const reloaded=gmSenderSetup({membership:{...member(user,'game_master'),active_character_id:id},
      activeCharacter:id?{id,name:'Elin'}:undefined})
    assert.equal(reloaded.render().speakerSelection.characterId,id)
    assert.equal(reloaded.render().speakerSelection.characters.length,2)
    assert.equal(reloaded.b.requests.length,0,'mount must never repair/write server selection')
    reloaded.h.cleanup()
  }
})
for(const [initial,requested,server] of [[other,null,'B'],[null,other,null]]) {
  test(`GM pending ${requested} releases to divergent canonical ${server} after request AND refetch`,async()=>{
    let finishRefresh,refreshes=0
    const f=gmSenderSetup({membership:{...member(user,'game_master'),active_character_id:initial},
      onAccessRefresh(){refreshes++;return new Promise(resolve=>{finishRefresh=resolve})}})
    const pending=f.render().speakerSelection.onChange(requested)
    assert.equal(f.render().speakerSelection.disabled,true)
    await f.render().speakerSelection.onChange(server)
    assert.equal(f.b.requests.length,1,'no parallel selection during write')
    f.b.requests[0].resolve({data:null,error:null});await settle()
    assert.equal(refreshes,1)
    assert.equal(f.render().speakerSelection.disabled,true,'pending also spans canonical refetch')
    canonicalSpeaker(f,server)
    finishRefresh();await pending
    assert.equal(f.render().speakerSelection.characterId,server)
    assert.equal(f.render().speakerSelection.disabled,false)
    canonicalSpeaker(f,initial)
    assert.equal(f.render().speakerSelection.characterId,initial,'later realtime/focus state stays canonical')
    f.h.cleanup()
  })
}
test('GM RPC failure releases pending to latest server state instead of captured mode',async()=>{
  const f=gmSenderSetup()
  const pending=f.render().speakerSelection.onChange(null)
  canonicalSpeaker(f,'B')
  f.b.requests[0].resolve({data:null,error:{message:'failed'}});await pending
  let panel=f.render()
  assert.equal(panel.speakerSelection.characterId,'B')
  assert.equal(panel.speakerSelection.disabled,false)
  assert.match(panel.speakerSelection.error,/konnte nicht/)
  assert.equal(panel.disabledReason,null,'failed selection does not permanently block the canonical speaker')
  panel=await chooseSpeaker(f,null)
  assert.equal(panel.disabledReason,null)
  assert.equal(panel.speakerSelection.characterId,null)
  f.h.cleanup()
})
test('GM pending completion after role loss or unmount cannot refresh or restore selection',async()=>{
  for(const unmount of [false,true]) {
    let refreshes=0
    const f=gmSenderSetup({onAccessRefresh(){refreshes++}})
    const pending=f.render().speakerSelection.onChange(null)
    if(unmount) f.h.cleanup()
    else f.render({membership:member()})
    f.b.requests[0].resolve({data:null,error:null});await pending
    assert.equal(refreshes,0)
    if(!unmount) {
      assert.equal(f.render().speakerSelection,undefined)
      canonicalSpeaker(f,other)
      assert.equal(f.render().speakerSelection.characterId,other)
      f.h.cleanup()
    }
  }
})
test('GM speaker initialization is read-only for either async load order and keeps player behavior',()=>{
  const charactersFirst=gmSenderSetup({membership:undefined,isSpeakerLoading:true})
  assert.equal(charactersFirst.render().speakerSelection,undefined)
  let panel=charactersFirst.render({membership:{...member(user,'game_master'),active_character_id:null},isSpeakerLoading:false})
  assert.equal(panel.speakerSelection.characterId,null)
  assert.equal(panel.speakerSelection.characters.length,2)
  assert.equal(charactersFirst.b.requests.length,0)
  charactersFirst.h.cleanup()
  const membershipFirst=gmSenderSetup({activeCharacter:undefined,ownCharacters:[],isSpeakerLoading:true})
  assert.equal(membershipFirst.b.requests.length,0)
  panel=membershipFirst.render({activeCharacter:{id:other,name:'Elin'},ownCharacters:[{id:other,name:'Elin'}],isSpeakerLoading:false})
  assert.equal(panel.speakerSelection.characterId,other)
  panel=membershipFirst.render({membership:{...member(user,'player'),active_character_id:other}})
  assert.equal(panel.speakerSelection,undefined)
  assert.equal(panel.speakerName,'Elin')
  assert.equal(membershipFirst.b.requests.length,0)
  membershipFirst.h.cleanup()
})
for(const [firstId,nextId] of [[other,null],[null,other],[other,'B']]) {
  test(`sender identity ${firstId} to ${nextId}: new intent gets a fresh ID; explicit retry retains old body and identity`,async()=>{
    const f=sendSetup(),{b,h,hook,args}=f
    h.render(hook,[...args.slice(0,2),firstId,...args.slice(3)])
    const first=h.render().send(),original={...b.requests[0].args}
    // Switching during flight must not permit any parallel new send or retry.
    h.render(hook,[...args.slice(0,2),nextId,...args.slice(3)])
    assert.equal(await h.render().send(),false);assert.equal(await h.render().retry(),false)
    assert.deepEqual({...b.requests[0].args},original)
    b.requests[0].reject(Error('timeout'));await first
    assert.equal(h.render().hasDifferentPendingAttempt,true)
    const retry=h.render().retry()
    assert.deepEqual({...b.requests[1].args},original)
    b.requests[1].reject(Error('timeout again'));await retry
    const fresh=h.render().send()
    assert.equal(b.requests[2].args.p_expected_active_character_id,nextId)
    assert.equal(b.requests[2].args.p_body,original.p_body)
    assert.notEqual(b.requests[2].args.p_client_request_id,original.p_client_request_id)
    await confirmSend(f,fresh);h.cleanup()
  })
}
test('sender mode round trip is a new intent, but unchanged rerenders and renames preserve an ordinary retry',async()=>{
  const f=gmSenderSetup()
  f.render().composer.setText('Unklar');const first=f.render().composer.send()
  f.b.requests[0].reject(Error('timeout'));await first
  f.render({activeCharacter:{id:other,name:'Elin Neu'}})
  const retry=f.render().composer.send()
  assert.deepEqual(f.b.requests[1].args,f.b.requests[0].args)
  f.b.requests[1].reject(Error('timeout'));await retry
  await chooseSpeaker(f,null)
  await chooseSpeaker(f,other)
  const fresh=f.render().composer.send()
  assert.notEqual(f.b.requests.at(-1).args.p_client_request_id,f.b.requests[0].args.p_client_request_id)
  await confirmSend(f,fresh);f.h.cleanup()
})
for(const desktop of [true,false]) {
  test(`GM composer ${desktop?'desktop':'mobile'}: exactly two mode options, native input, explicit original retry and normal player label`,()=>{
    const document={body:{style:{overflow:''}}},h=harness({}, {document})
    const Panel=h.load('src/components/PlayChatPanel.tsx').default
    let selected,retries=0,sends=0
    const name='Elin '.repeat(40)
    let props={isDesktop:desktop,isOpen:true,onClose(){},chat:emptyChat(),
      composer:{...emptyComposer(),text:'Text',hasDifferentPendingAttempt:true,retry:()=>{retries++;return false},send:()=>{sends++;return false}},
      disabledReason:null,speakerName:name,speakerSelection:{characterId:other,characters:[{id:other,name}],disabled:false,onChange:id=>{selected=id}},unreadCount:0,onRead(){}}
    let tree=h.render(Panel,[props]),select=nodes(tree).find(n=>n.type==='select')
    assert.deepEqual(nodes(select).filter(n=>n.type==='option').map(n=>n.props.value),[other,''])
    assert.equal(select.props.title,name);assert.equal(select.props.disabled,false)
    assert.equal(select.props.onMouseDown,undefined);assert.equal(select.props.onPointerDown,undefined)
    select.props.onChange({target:{value:''}});assert.equal(selected,null)
    nodes(tree).find(n=>n.type==='button'&&textOf(n)==='Vorherigen Sendeversuch wiederholen').props.onClick()
    assert.equal(retries,1);assert.equal(sends,0)
    tree=h.render(Panel,[{...props,speakerSelection:{...props.speakerSelection,characterId:null,characters:[]}}])
    assert.deepEqual(nodes(tree).filter(n=>n.type==='option').map(n=>n.props.value),[''])
    tree=h.render(Panel,[{...props,speakerSelection:undefined}])
    assert.equal(nodes(tree).filter(n=>n.type==='select').length,0)
    assert.match(textOf(tree),/Schreiben als Elin/);h.cleanup()
  })
}
test('active-character query adds a server ID filter and drops obsolete records/responses on ID changes',async()=>{
  const b=backend(),h=harness(b.api),hook=h.load('src/hooks/useRoundCharacters.ts').useRoundCharacters
  h.render(hook,[round,`${user}:game_master`,other])
  assert.equal(b.requests[0].id,other);assert.equal(b.requests[0].round_id,round);assert.equal(b.requests[0].deleted_at,null)
  b.requests[0].resolve({data:[character(other)],error:null});await tick()
  assert.equal(h.render().characters[0].id,other)
  h.render().reload();const old=b.requests[1]
  assert.equal(h.render(hook,[round,`${user}:game_master`,'B']).characters.length,0)
  assert.equal(old.signal.aborted,true);assert.equal(b.requests[2].id,'B')
  old.resolve({data:[character(other)],error:null});await tick()
  assert.equal(h.render().characters.length,0)
  b.requests[2].resolve({data:[character('B')],error:null});await tick()
  assert.equal(h.render().characters[0].id,'B')
  h.render(hook,[round,`${user}:player`,'B']);assert.equal(h.render().characters.length,0)
  h.cleanup()
})
test('GM play page loads own choices independently of active ID and reconciles using the existing character subscription',async()=>{
  const b=backend(),clock=browserClock()
  const h=harness(b.api,clock,{
    'react-router-dom':{useParams:()=>({roundId:round}),Link:'Link'},'../auth/useAuth':{useAuth:()=>({user:{id:user}})},
    '../components/PlayModeHeader':{default:'PlayModeHeader'},'../components/PlayMainContent':{default:'PlayMainContent'},
    '../components/PlayChatPanel':{default:'PlayChatPanel'},'../hooks/useRoundMessages':{useRoundMessages:emptyChat},
  })
  const Page=h.load('src/pages/RoundPlayPage.tsx').default
  h.render(Page,[])
  b.requests[0].resolve({data:roundData('game_master'),error:null})
  b.requests[1].resolve({data:[{...member(user,'game_master'),active_character_id:null}],error:null});await tick()
  assert.equal(h.render().props.isSpeakerLoading,true)
  assert.equal(b.requests[2].table,'characters');assert.equal(b.requests[2].id,undefined)
  assert.equal(b.requests[2].owner_user_id,user)
  b.requests[2].resolve({data:[{...character(other),name:'Elin'},character('foreign','someone-else')],error:null});await tick()
  assert.equal(h.render().props.activeCharacter,undefined)
  assert.deepEqual(Array.from(h.render().props.ownCharacters,c=>c.id),[other])
  const channel=b.channels.find(c=>c.config.table==='characters')
  assert.equal(channel.config.filter,`owner_user_id=eq.${user}`)
  channel.cb();clock.advance()
  const refresh=b.requests.findLast(r=>r.table==='characters')
  assert.equal(refresh.owner_user_id,user)
  refresh.resolve({data:[{...character(other),name:'Elin Neu'}],error:null});await tick()
  assert.equal(h.render().props.ownCharacters[0].name,'Elin Neu')
  const membershipRequest=b.requests.findLast(r=>r.table==='round_memberships'&&!r.user_id)
  membershipRequest.resolve({data:[{...member(user,'game_master'),active_character_id:other}],error:null});await tick()
  assert.equal(h.render().props.activeCharacter.id,other)
  assert.equal(b.requests.filter(r=>r.table==='characters').length,2,'active ID switch reuses the same own-character list')
  assert.equal(b.requests.filter(r=>r.rpc).length,0,'mount and reconciliation remain read-only')
  h.cleanup()
})

test('GM selection during successful send leaves its captured request untouched',async()=>{
  const f=gmSenderSetup()
  f.render().composer.setText('Erste Nachricht')
  const first=f.render().composer.send(),original={...f.b.requests[0].args}
  await chooseSpeaker(f,null)
  assert.equal(f.render().composer.isSending,true)
  assert.equal(await f.render().composer.send(),false)
  assert.deepEqual({...f.b.requests[0].args},original)
  f.b.requests[0].resolve({data:chatMessage(1,{client_request_id:original.p_client_request_id}),error:null})
  assert.equal(await first,true)
  assert.equal(f.render().speakerSelection.characterId,null)
  f.render().composer.setText('Zweite Nachricht')
  await confirmSend(f,f.render().composer.send())
  assert.equal(f.b.requests.at(-1).args.p_expected_active_character_id,null)
  await chooseSpeaker(f,'B')
  f.render().composer.setText('Dritte Nachricht')
  await confirmSend(f,f.render().composer.send())
  assert.equal(f.b.requests.at(-1).args.p_expected_active_character_id,'B')
  assert.equal(new Set(f.b.requests.filter(r=>r.rpc==='send_round_message').map(r=>r.args.p_client_request_id)).size,3)
  f.h.cleanup()
})

test('membership reload completion waits for its trailing fetch and settles on error/unmount',async()=>{
  for(const outcome of ['success','error','unmount']) {
    const b=backend(),h=harness(b.api),hook=h.load('src/hooks/useRoundMembers.ts').useRoundMembers
    h.render(hook,[round,user])
    let finished=false
    const pending=h.render().reload().then(()=>{finished=true})
    b.requests[0].resolve({data:[member()],error:null});await settle()
    assert.equal(finished,false,'old in-flight membership response cannot finish a post-write refetch')
    assert.equal(b.requests.length,2)
    if(outcome==='unmount') h.cleanup()
    else b.requests[1].resolve({data:outcome==='success'?[{...member(),active_character_id:null}]:null,
      error:outcome==='error'?{message:'offline'}:null})
    await pending
    assert.equal(finished,true)
    if(outcome==='success') assert.equal(h.render().members[0].active_character_id,null)
    h.cleanup()
  }
})

// Phase 3.5a: the command parser is pure; the existing composer owns both send paths.
test('dice command parser accepts XdN±M and normalized dN±M shorthand within exact boundaries',()=>{
  const h=harness({}),{isDiceCommand,parseDiceCommand}=h.load('src/lib/parseDiceCommand.ts')
  for(const [input,count,sides,modifier] of [
    ['/r 1d20',1,20,0],['/r 3d6',3,6,0],['/r 3d6+5',3,6,5],
    ['/r 2d10-2',2,10,-2],['/r 1d100-10',1,100,-10],
    ['/r 3D6+5',3,6,5],['/r 3d6 + 5',3,6,5],['/r    3d6',3,6,0],
    ['   /r 3d6+2   ',3,6,2],['/r 1d2',1,2,0],['/r 50d1000',50,1000,0],
    ['/r 1d6+9999',1,6,9999],['/r 1d6-9999',1,6,-9999],['/r 1d6+0',1,6,0],
    ['/r d20',1,20,0],['/r d20+5',1,20,5],['/r d20-5',1,20,-5],
    ['/r d20 - 3',1,20,-3],['/r d100-10',1,100,-10],['/r D6',1,6,0],
    ['/r d2',1,2,0],['/r d1000',1,1000,0],
  ]) {
    assert.equal(isDiceCommand(input),true,input)
    assert.deepEqual(JSON.parse(JSON.stringify(parseDiceCommand(input))),{diceCount:count,diceSides:sides,modifier},input)
  }
  assert.deepEqual(JSON.parse(JSON.stringify(parseDiceCommand('/r d20'))),
    JSON.parse(JSON.stringify(parseDiceCommand('/r 1d20'))))
  h.cleanup()
})

test('dice command parser rejects partial or out-of-range expressions without claiming other text',()=>{
  const h=harness({}),{isDiceCommand,parseDiceCommand}=h.load('src/lib/parseDiceCommand.ts')
  for(const input of ['/r','/r d','/r d1','/r d1001','/r d20+10000','/r d20-10000',
    '/r d20+2d6','/r dd20','/r d20foo','/r 0d6','/r 51d6','/r 1d1','/r 1d1001',
    '/r 1d6+10000','/r 1d6-10000','/r 2d6+1d4','/r 2.5d6','/r 2d6+3.5',
    '/r foo','/r 2d6abc','/r 2d6 text','/r 2d6+Infinity','/r 2d6+999999999999999999999']) {
    assert.equal(isDiceCommand(input),true,input)
    assert.equal(parseDiceCommand(input),null,input)
  }
  for(const input of ['Hallo','/random Hallo','/rhello','/roll 2d6','/R 2d6']) {
    assert.equal(isDiceCommand(input),false,input)
    assert.equal(parseDiceCommand(input),null,input)
  }
  h.cleanup()
})

function diceSendSetup(text,onSent=()=>{},onAccessRefresh=()=>{}) {
  const f=sendSetup(onSent,onAccessRefresh)
  f.h.render().setText(text)
  return f
}
function confirmedDice(request,overrides={}) {
  return diceMessage(101,{client_request_id:request.args.p_client_request_id,...overrides})
}

test('composer routes only standalone /r to dice; ordinary and /r-prefixed words remain chat',async()=>{
  for(const input of ['Hallo','/random Hallo','/rhello']) {
    const f=diceSendSetup(input)
    const pending=f.h.render().send()
    assert.equal(f.b.requests[0].rpc,'send_round_message',input)
    assert.equal(f.b.requests[0].args.p_body,input)
    f.b.requests[0].resolve({data:chatMessage(101,{client_request_id:f.b.requests[0].args.p_client_request_id}),error:null})
    assert.equal(await pending,true);f.h.cleanup()
  }
  for(const input of ['/r','/r d','/r d1','/r d1001','/r d20+10000',
    '/r d20-10000','/r d20+2d6','/r dd20','/r d20foo',
    '/r 2d6+foo','/r 2d6+1d4']) {
    const f=diceSendSetup(input)
    assert.equal(await f.h.render().send(),false)
    assert.equal(f.b.requests.length,0,input)
    assert.equal(f.h.render().text,input)
    assert.match(f.h.render().error,/Ungültiger Würfelbefehl/)
    f.h.cleanup()
  }
})

test('dice RPC receives only structured count, sides, modifier, round, intent and fresh request ID',async()=>{
  for(const [text,count,sides,modifier] of [
    ['/r d20',1,20,0],['/r 1d20',1,20,0],['/r d20+5',1,20,5],
    ['/r 3d6',3,6,0],['/r 3d6+5',3,6,5],['/r 2d10-2',2,10,-2],
  ]) {
    let synced=0
    const f=diceSendSetup(text,()=>synced++)
    const pending=f.h.render().send(),request=f.b.requests[0]
    assert.equal(request.rpc,'send_round_dice_roll')
    assert.deepEqual(Object.keys(request.args).sort(),[
      'p_client_request_id','p_dice_count','p_dice_sides','p_expected_active_character_id','p_modifier','p_round_id',
    ])
    assert.equal(request.args.p_round_id,round)
    assert.equal(request.args.p_dice_count,count)
    assert.equal(request.args.p_dice_sides,sides)
    assert.equal(request.args.p_modifier,modifier)
    assert.equal(request.args.p_expected_active_character_id,other)
    assert.equal(f.h.render().text,text,'draft remains until confirmation')
    request.resolve({data:confirmedDice(request),error:null})
    assert.equal(await pending,true)
    assert.equal(f.h.render().text,'');assert.equal(f.h.render().error,null);assert.equal(synced,1)
    f.h.cleanup()
  }
})

test('dice send rejects wrong kind, round, request ID or missing detail after the shared decoder',async()=>{
  for(const mutate of [
    request=>chatMessage(101,{client_request_id:request.args.p_client_request_id}),
    request=>confirmedDice(request,{round_id:'other-round'}),
    request=>confirmedDice(request,{client_request_id:'another-request'}),
    request=>confirmedDice(request,{dice_roll:null}),
  ]) {
    let synced=0
    const f=diceSendSetup('/r 1d20',()=>synced++)
    const pending=f.h.render().send(),request=f.b.requests[0]
    request.resolve({data:mutate(request),error:null})
    assert.equal(await pending,false)
    assert.equal(f.h.render().text,'/r 1d20')
    assert.ok(f.h.render().error);assert.equal(synced,0)
    const retry=f.h.render().send(),repeated=f.b.requests[1]
    assert.equal(repeated.args.p_client_request_id,request.args.p_client_request_id)
    repeated.resolve({data:confirmedDice(repeated),error:null})
    assert.equal(await retry,true);assert.equal(f.h.render().text,'');assert.equal(synced,1)
    f.h.cleanup()
  }
})

test('dice timeout retries its immutable request, then a new roll gets a fresh UUID',async()=>{
  const f=diceSendSetup('/r 3d6+2')
  const first=f.h.render().send()
  f.b.requests[0].reject(Error('timeout'));assert.equal(await first,false)
  assert.equal(f.h.render().text,'/r 3d6+2')
  const second=f.h.render().send()
  assert.equal(f.b.requests[1].args.p_client_request_id,f.b.requests[0].args.p_client_request_id)
  f.b.requests[1].resolve({data:confirmedDice(f.b.requests[1]),error:null})
  assert.equal(await second,true)
  f.h.render().setText('/r 3d6+2')
  const third=f.h.render().send()
  assert.notEqual(f.b.requests[2].args.p_client_request_id,f.b.requests[0].args.p_client_request_id)
  f.b.requests[2].resolve({data:confirmedDice(f.b.requests[2]),error:null})
  assert.equal(await third,true)
  f.h.cleanup()
})

test('editing a dice draft after an ambiguous failure starts a new request',async()=>{
  const f=diceSendSetup('/r 2d6')
  const first=f.h.render().send(),original=f.b.requests[0]
  original.reject(Error('connection lost'));assert.equal(await first,false)
  f.h.render().setText('/r 3d6')
  const changed=f.h.render().send(),next=f.b.requests[1]
  assert.notEqual(next.args.p_client_request_id,original.args.p_client_request_id)
  assert.equal(next.args.p_dice_count,3)
  next.resolve({data:confirmedDice(next),error:null})
  assert.equal(await changed,true);f.h.cleanup()
})

test('an unknown dice RPC error keeps the request ID for an idempotent retry',async()=>{
  const f=diceSendSetup('/r 2d6')
  const first=f.h.render().send(),original=f.b.requests[0]
  original.resolve({data:null,error:{message:'UNRECOGNIZED_SERVER_ERROR'}})
  assert.equal(await first,false);assert.equal(f.h.render().text,'/r 2d6')
  const retry=f.h.render().send(),repeated=f.b.requests[1]
  assert.equal(repeated.args.p_client_request_id,original.args.p_client_request_id)
  repeated.resolve({data:confirmedDice(repeated),error:null})
  assert.equal(await retry,true);f.h.cleanup()
})

test('dice in flight blocks duplicate submits and immediately releases the composer on completion',async()=>{
  const f=diceSendSetup('/r 2d6')
  const first=f.h.render().send()
  assert.equal(await f.h.render().send(),false)
  assert.equal(f.b.requests.length,1);assert.equal(f.h.render().isSending,true)
  f.b.requests[0].resolve({data:confirmedDice(f.b.requests[0]),error:null})
  assert.equal(await first,true)
  f.h.render().setText('/r 2d6')
  const next=f.h.render().send()
  assert.equal(f.b.requests.length,2)
  assert.notEqual(f.b.requests[1].args.p_client_request_id,f.b.requests[0].args.p_client_request_id)
  f.b.requests[1].resolve({data:confirmedDice(f.b.requests[1]),error:null})
  assert.equal(await next,true);f.h.cleanup()
})

test('definitive dice rejections preserve the draft but release the request ID',async()=>{
  for(const [code,meaning] of [
    ['CHAT_IDENTITY_CHANGED','Sprecheridentität'],['CHAT_CHARACTER_UNAVAILABLE','Charakter'],
    ['CHAT_NO_ACTIVE_CHARACTER','aktiven Charakter'],
    ['CHAT_ROUND_ARCHIVED','Archivierte'],['CHAT_ROUND_LOCKED','gesperrt'],
    ['CHAT_NOT_AUTHORIZED','keinen Zugriff'],['CHAT_REQUEST_CONFLICT','erneut senden'],
    ['DICE_INVALID_PARAMETERS','Ungültiger Würfelbefehl'],
    ['DICE_STORED_ROLL_INCOMPLETE','unvollständig'],
  ]) {
    let refreshed=0
    const f=diceSendSetup('/r 2d6',()=>{},()=>refreshed++)
    const pending=f.h.render().send(),request=f.b.requests[0]
    request.resolve({data:null,error:{message:code}})
    assert.equal(await pending,false)
    assert.equal(f.b.requests.length,1,'a rejection must not start another roll')
    assert.equal(f.h.render().text,'/r 2d6');assert.match(f.h.render().error,new RegExp(meaning))
    assert.equal(refreshed,1)
    const next=f.h.render().send(),newRequest=f.b.requests[1]
    assert.notEqual(newRequest.args.p_client_request_id,request.args.p_client_request_id,code)
    newRequest.resolve({data:confirmedDice(newRequest),error:null})
    assert.equal(await next,true);assert.equal(f.h.render().text,'')
    f.h.cleanup()
  }
})

test('GM composer passes selected own character or explicit narration null to dice RPC',async()=>{
  const f=gmSenderSetup()
  f.render().composer.setText('/r 2d6')
  const first=f.render().composer.send(),request=f.b.requests[0]
  assert.equal(request.rpc,'send_round_dice_roll')
  assert.equal(request.args.p_expected_active_character_id,other)
  request.resolve({data:confirmedDice(request),error:null});assert.equal(await first,true)
  canonicalSpeaker(f,null)
  f.render().composer.setText('/r 2d6')
  const second=f.render().composer.send(),narration=f.b.requests.at(-1)
  assert.equal(narration.rpc,'send_round_dice_roll')
  assert.equal(narration.args.p_expected_active_character_id,null)
  narration.resolve({data:confirmedDice(narration,{speaker_kind:'game_master',speaker_name_snapshot:'Spielleitung',character_id:null}),error:null})
  assert.equal(await second,true);f.h.cleanup()
})

test('the existing form and Enter path submit /r through the same composer, preserving Shift+Enter',()=>{
  let sends=0
  const h=harness({}, {document:{body:{style:{overflow:''}}}})
  const Panel=h.load('src/components/PlayChatPanel.tsx').default
  const props={isDesktop:true,isOpen:true,onClose(){},chat:emptyChat(),composer:{...emptyComposer(),text:'/r 2d6',send:()=>{sends++;return false}},
    disabledReason:null,speakerName:'Astrid',unreadCount:0,onRead(){}}
  const tree=h.render(Panel,[props]),input=nodes(tree).find(n=>n.type==='textarea')
  input.props.onKeyDown({key:'Enter',shiftKey:true,nativeEvent:{isComposing:false},preventDefault(){throw Error('Shift+Enter stays native')}})
  input.props.onKeyDown({key:'Enter',shiftKey:false,nativeEvent:{isComposing:false},preventDefault(){}})
  nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}})
  assert.equal(sends,2)
  const invalid=h.render(Panel,[{...props,composer:{...props.composer,text:'/r'}}])
  assert.equal(nodes(invalid).find(n=>n.type==='button'&&n.props.type==='submit').props.disabled,false)
  h.cleanup()
})

test('desktop and mobile chat toggle native help without submitting or changing the draft',()=>{
  for(const isDesktop of [true,false]) {
    let sends=0,edits=0
    const h=harness({}, {document:{body:{style:{overflow:''}}}})
    const Panel=h.load('src/components/PlayChatPanel.tsx').default
    const props={isDesktop,isOpen:false,onClose(){},chat:emptyChat(),
      composer:{...emptyComposer(),text:'Mein Entwurf',send:()=>{sends++;return false},setText:()=>edits++},
      disabledReason:null,speakerName:'Astrid',unreadCount:0,onRead(){}}
    const tree=h.render(Panel,[props]),help=nodes(tree).find(n=>n.type==='details'&&n.props.className==='play-chat-help')
    assert.ok(help)
    assert.equal(help.props.open,undefined,'native details are closed by default')
    const summary=nodes(help).find(n=>n.type==='summary')
    assert.equal(summary.props.children,'Chat & Würfelbefehle')
    assert.equal(nodes(help).some(n=>n.type==='form'||n.type==='button'),false,'help cannot submit the form')
    for(const example of ['/r d20','/r 3d6','/r 3d6+5','/r 2d10-2']) assert.ok(textOf(help).includes(example),example)
    assert.match(textOf(help),/1 bis 50 Würfel/)
    assert.match(textOf(help),/d2 bis d1000/)
    assert.match(textOf(help),/Modifier −9999 bis \+9999/)
    assert.match(textOf(help),/nur eine Würfelart/)

    // The hook harness has no live DOM. Model the browser's native summary
    // activation on the actual rendered details node by toggling its open IDL state.
    help.open=help.props.open===true
    assert.equal(help.open,false)
    help.open=!help.open
    assert.equal(help.open,true,'activating summary opens the native details element')

    assert.equal(nodes(h.render()).find(n=>n.type==='textarea').props.value,'Mein Entwurf')
    assert.equal(sends,0);assert.equal(edits,0)
    h.cleanup()
  }
})

function quickDiceUiSetup(sendDice=()=>false) {
  const h=harness({}, {document:{body:{style:{overflow:''}}}})
  const QuickDice=h.load('src/components/PlayChatPanel.tsx').QuickDiceControls
  const composer={...emptyComposer(),text:'Ich öffne die Tür',sendDice}
  const render=changes=>h.render(QuickDice,[{composer:{...composer,...changes},disabledReason:null}])
  const button=(tree,name)=>nodes(tree).find(n=>n.type==='button'&&n.props['aria-label']===name)
  return {h,render,button,composer}
}

test('quick dice selection switches one pool, corrects count, caps at 50 and resets',()=>{
  const f=quickDiceUiSetup()
  let tree=f.render()
  assert.match(textOf(nodes(tree).find(n=>n.type==='output')),/Noch kein Würfel/)
  const click=name=>{f.button(tree,name).props.onClick();tree=f.render()}
  click('d6 hinzufügen');assert.equal(textOf(nodes(tree).find(n=>n.type==='output')),'1d6')
  click('d6 hinzufügen');assert.equal(textOf(nodes(tree).find(n=>n.type==='output')),'2d6')
  click('d6 hinzufügen');assert.equal(textOf(nodes(tree).find(n=>n.type==='output')),'3d6')
  click('Anzahl verringern');assert.equal(textOf(nodes(tree).find(n=>n.type==='output')),'2d6')
  click('Anzahl verringern');assert.equal(textOf(nodes(tree).find(n=>n.type==='output')),'1d6')
  click('Anzahl verringern');assert.match(textOf(tree),/Noch kein Würfel ausgewählt/)
  click('d6 hinzufügen');click('d6 hinzufügen');click('d6 hinzufügen')
  click('d20 hinzufügen');assert.equal(textOf(nodes(tree).find(n=>n.type==='output')),'1d20')
  assert.equal(f.button(tree,'d20 hinzufügen').props['aria-pressed'],true)
  click('Anzahl verringern');assert.match(textOf(tree),/Noch kein Würfel ausgewählt/)
  click('d6 hinzufügen');click('Anzahl erhöhen')
  assert.equal(textOf(nodes(tree).find(n=>n.type==='output')),'2d6')
  for(let count=2;count<50;count++)click('Anzahl erhöhen')
  assert.equal(textOf(nodes(tree).find(n=>n.type==='output')),'50d6')
  assert.equal(f.button(tree,'Anzahl erhöhen').props.disabled,true)
  f.button(tree,'d6 hinzufügen').props.onClick();tree=f.render()
  assert.equal(textOf(nodes(tree).find(n=>n.type==='output')),'50d6','same die cannot create 51 dice')
  nodes(tree).find(n=>n.type==='button'&&textOf(n)==='Schnellwürfel zurücksetzen').props.onClick();tree=f.render()
  assert.match(textOf(tree),/Noch kein Würfel ausgewählt/)
  assert.equal(nodes(tree).find(n=>n.type==='input').props.value,'0')
  f.h.cleanup()
})

test('quick dice modifier accepts integers and boundaries while invalid values cannot roll',()=>{
  const rolls=[],f=quickDiceUiSetup(dice=>{rolls.push(dice);return false})
  let tree=f.render();f.button(tree,'d6 hinzufügen').props.onClick();tree=f.render()
  const setModifier=value=>{
    nodes(tree).find(n=>n.type==='input').props.onChange({target:{value}});tree=f.render()
  }
  const roll=()=>nodes(tree).find(n=>n.type==='button'&&textOf(n)==='Würfeln').props.onClick()
  for(const [value,modifier,preview] of [['0',0,'1d6'],['5',5,'1d6+5'],['+5',5,'1d6+5'],['-2',-2,'1d6-2'],
    ['9999',9999,'1d6+9999'],['+9999',9999,'1d6+9999'],['-9999',-9999,'1d6-9999'],
    ['',0,'1d6'],['   ',0,'1d6']]) {
    setModifier(value);assert.equal(textOf(nodes(tree).find(n=>n.type==='output')),preview);roll()
    assert.equal(rolls.at(-1).modifier,modifier)
  }
  const validRolls=rolls.length
  for(const value of ['-','+','--','*','1.5','+1.5','abc','10000','+10000','-10000']) {
    setModifier(value)
    const rollButton=nodes(tree).find(n=>n.type==='button'&&textOf(n)==='Würfeln')
    assert.equal(rollButton.props.disabled,true,value);rollButton.props.onClick()
    assert.equal(rolls.length,validRolls,value)
  }
  f.h.cleanup()
})

test('quick dice reset clears its pool and modifier without touching draft or either send path',()=>{
  let diceSends=0,textSends=0,draftEdits=0
  const f=quickDiceUiSetup(()=>diceSends++)
  f.composer.send=()=>textSends++
  f.composer.setText=()=>draftEdits++
  let tree=f.render()
  const click=name=>{f.button(tree,name).props.onClick();tree=f.render()}
  click('d6 hinzufügen');click('d6 hinzufügen');click('d6 hinzufügen')
  nodes(tree).find(n=>n.type==='input').props.onChange({target:{value:'2'}});tree=f.render()
  assert.equal(textOf(nodes(tree).find(n=>n.type==='output')),'3d6+2')
  nodes(tree).find(n=>n.type==='button'&&textOf(n)==='Schnellwürfel zurücksetzen').props.onClick();tree=f.render()
  assert.match(textOf(tree),/Noch kein Würfel ausgewählt/)
  assert.equal(nodes(tree).find(n=>n.type==='input').props.value,'0')
  assert.equal(f.composer.text,'Ich öffne die Tür')
  assert.equal(draftEdits,0);assert.equal(diceSends,0);assert.equal(textSends,0)
  f.h.cleanup()
})

test('quick dice UI keeps its selection after send and never edits the chat draft',()=>{
  const rolls=[],f=quickDiceUiSetup(dice=>{rolls.push(dice);return Promise.resolve(true)})
  let tree=f.render();f.button(tree,'d6 hinzufügen').props.onClick();tree=f.render()
  f.button(tree,'d6 hinzufügen').props.onClick();tree=f.render()
  nodes(tree).find(n=>n.type==='input').props.onChange({target:{value:'2'}});tree=f.render()
  nodes(tree).find(n=>n.type==='button'&&textOf(n)==='Würfeln').props.onClick();tree=f.render()
  assert.deepEqual(JSON.parse(JSON.stringify(rolls)),[{diceCount:2,diceSides:6,modifier:2}])
  assert.equal(textOf(nodes(tree).find(n=>n.type==='output')),'2d6+2')
  assert.equal(nodes(tree).some(n=>n.type==='textarea'),false,'quick controls do not own or edit the chat field')
  f.h.cleanup()
})

test('reroll leaves prepared quick dice and the chat draft untouched',()=>{
  const rerolls=[]
  const f=quickDiceUiSetup()
  f.composer.sendReroll=(source,dice)=>rerolls.push({source,dice})
  let tree=f.render()
  f.button(tree,'d20 hinzufügen').props.onClick();tree=f.render()
  f.button(tree,'d20 hinzufügen').props.onClick();tree=f.render()
  nodes(tree).find(node=>node.type==='input').props.onChange({target:{value:'1'}});tree=f.render()
  assert.equal(textOf(nodes(tree).find(node=>node.type==='output')),'2d20+1')

  const View=f.h.load('src/components/PlayChatPanel.tsx').DiceRollMessageView
  const details={message_id:'message-template',dice_count:3,dice_sides:6,modifier:2,
    results:[2,6,4],raw_total:12,total:14}
  const view=f.h.render(View,[{details,rerollDisabled:false,
    onReroll:()=>f.composer.sendReroll(details.message_id,{diceCount:3,diceSides:6,modifier:2})}])
  nodes(view).find(node=>node.type==='button'&&textOf(node)==='↻ Nochmal würfeln').props.onClick()

  tree=f.render()
  assert.equal(textOf(nodes(tree).find(node=>node.type==='output')),'2d20+1')
  assert.equal(nodes(tree).find(node=>node.type==='input').props.value,'1')
  assert.equal(f.composer.text,'Ich öffne die Tür')
  assert.deepEqual(JSON.parse(JSON.stringify(rerolls)),[{source:'message-template',
    dice:{diceCount:3,diceSides:6,modifier:2}}])
  f.h.cleanup()
})

test('quick dice uses the shared structured RPC path and preserves the chat draft on success and error',async()=>{
  let synced=0
  const f=sendSetup(()=>synced++)
  f.h.render().setText('Ich öffne die Tür')
  const first=f.h.render().sendDice({diceCount:3,diceSides:6,modifier:5}),request=f.b.requests[0]
  assert.equal(request.rpc,'send_round_dice_roll')
  assert.equal('p_body' in request.args,false)
  assert.deepEqual({...request.args},{p_round_id:round,p_dice_count:3,p_dice_sides:6,p_modifier:5,
    p_client_request_id:request.args.p_client_request_id,p_expected_active_character_id:other})
  request.resolve({data:confirmedDice(request),error:null})
  assert.equal(await first,true);assert.equal(f.h.render().text,'Ich öffne die Tür');assert.equal(synced,1)

  const failed=f.h.render().sendDice({diceCount:2,diceSides:10,modifier:-2}),failure=f.b.requests[1]
  failure.resolve({data:null,error:{message:'DICE_INVALID_PARAMETERS'}})
  assert.equal(await failed,false);assert.equal(f.h.render().text,'Ich öffne die Tür')
  assert.match(f.h.render().error,/Ungültiger Würfelbefehl/)
  const retried=f.h.render().sendDice({diceCount:2,diceSides:10,modifier:-2}),newRequest=f.b.requests[2]
  assert.notEqual(newRequest.args.p_client_request_id,failure.args.p_client_request_id)
  newRequest.resolve({data:confirmedDice(newRequest),error:null});assert.equal(await retried,true)
  f.h.cleanup()
})

test('quick dice retries one unchanged intent, releases it on success and replaces it after edits',async()=>{
  const f=sendSetup()
  f.h.render().setText('Entwurf bleibt')
  const dice={diceCount:3,diceSides:6,modifier:2}
  const first=f.h.render().sendDice(dice),original=f.b.requests[0]
  original.reject(Error('timeout'));assert.equal(await first,false)
  const retry=f.h.render().sendDice(dice),repeated=f.b.requests[1]
  assert.equal(repeated.args.p_client_request_id,original.args.p_client_request_id)
  repeated.reject(Error('decoder'));assert.equal(await retry,false)
  const changed=f.h.render().sendDice({...dice,modifier:3}),replacement=f.b.requests[2]
  assert.notEqual(replacement.args.p_client_request_id,original.args.p_client_request_id)
  replacement.resolve({data:confirmedDice(replacement),error:null});assert.equal(await changed,true)
  const next=f.h.render().sendDice({...dice,modifier:3}),fresh=f.b.requests[3]
  assert.notEqual(fresh.args.p_client_request_id,replacement.args.p_client_request_id)
  fresh.resolve({data:confirmedDice(fresh),error:null});assert.equal(await next,true)
  assert.equal(f.h.render().text,'Entwurf bleibt')
  f.h.cleanup()
})

test('quick dice count and type changes after ambiguous failures create new request IDs',async()=>{
  for(const changedDice of [
    {diceCount:4,diceSides:6,modifier:0},
    {diceCount:1,diceSides:20,modifier:0},
  ]) {
    const f=sendSetup()
    const first=f.h.render().sendDice({diceCount:3,diceSides:6,modifier:0}),original=f.b.requests[0]
    original.reject(Error('connection lost'));assert.equal(await first,false)
    const changed=f.h.render().sendDice(changedDice),replacement=f.b.requests[1]
    assert.notEqual(replacement.args.p_client_request_id,original.args.p_client_request_id)
    replacement.resolve({data:confirmedDice(replacement),error:null});assert.equal(await changed,true)
    f.h.cleanup()
  }
})

test('quick dice retries semantically equal plain and explicit positive modifiers with one request ID',async()=>{
  const f=sendSetup()
  const first=f.h.render().sendDice({diceCount:3,diceSides:6,modifier:Number('+5')}),original=f.b.requests[0]
  original.reject(Error('connection lost'));assert.equal(await first,false)
  const retry=f.h.render().sendDice({diceCount:3,diceSides:6,modifier:Number('5')}),repeated=f.b.requests[1]
  assert.equal(repeated.args.p_client_request_id,original.args.p_client_request_id)
  repeated.resolve({data:confirmedDice(repeated),error:null});assert.equal(await retry,true)
  f.h.cleanup()
})

test('quick dice blocks invalid structured values and duplicate submits',async()=>{
  const f=sendSetup()
  for(const dice of [
    {diceCount:0,diceSides:6,modifier:0},{diceCount:51,diceSides:6,modifier:0},
    {diceCount:1,diceSides:1,modifier:0},{diceCount:1,diceSides:1001,modifier:0},
    {diceCount:1,diceSides:6,modifier:10000},{diceCount:1,diceSides:6,modifier:-10000},
    {diceCount:1,diceSides:6,modifier:1.5},
  ]) assert.equal(await f.h.render().sendDice(dice),false)
  assert.equal(f.b.requests.length,0)
  const first=f.h.render().sendDice({diceCount:2,diceSides:6,modifier:0})
  assert.equal(await f.h.render().sendDice({diceCount:2,diceSides:6,modifier:0}),false)
  assert.equal(f.b.requests.length,1)
  f.b.requests[0].resolve({data:confirmedDice(f.b.requests[0]),error:null});assert.equal(await first,true)
  const next=f.h.render().sendDice({diceCount:2,diceSides:6,modifier:0})
  assert.equal(f.b.requests.length,2)
  f.b.requests[1].resolve({data:confirmedDice(f.b.requests[1]),error:null});assert.equal(await next,true)
  f.h.cleanup()
})

test('quick dice shares player, GM character and GM narration identity',async()=>{
  const player=sendSetup()
  let pending=player.h.render().sendDice({diceCount:1,diceSides:20,modifier:0})
  assert.equal(player.b.requests[0].args.p_expected_active_character_id,other)
  player.b.requests[0].resolve({data:confirmedDice(player.b.requests[0]),error:null});await pending;player.h.cleanup()

  const gm=gmSenderSetup()
  pending=gm.render().composer.sendDice({diceCount:1,diceSides:20,modifier:0})
  let request=gm.b.requests[0]
  assert.equal(request.args.p_expected_active_character_id,other)
  request.resolve({data:confirmedDice(request),error:null});await pending
  canonicalSpeaker(gm,null)
  pending=gm.render().composer.sendDice({diceCount:1,diceSides:20,modifier:0})
  request=gm.b.requests.at(-1)
  assert.equal(request.args.p_expected_active_character_id,null)
  request.resolve({data:confirmedDice(request,{speaker_kind:'game_master',speaker_name_snapshot:'Spielleitung',character_id:null}),error:null})
  assert.equal(await pending,true);gm.h.cleanup()
})

test('reroll uses the shared dice RPC with stored parameters, current identity and isolated draft',async()=>{
  let synced=0
  const f=sendSetup(()=>synced++)
  f.h.render().setText('Ich untersuche die Tür')
  const pending=f.h.render().sendReroll('foreign-message',{diceCount:3,diceSides:6,modifier:2})
  const request=f.b.requests[0]
  assert.equal(request.rpc,'send_round_dice_roll')
  assert.deepEqual(Object.keys(request.args).sort(),[
    'p_client_request_id','p_dice_count','p_dice_sides','p_expected_active_character_id','p_modifier','p_round_id',
  ])
  assert.equal('sourceMessageId' in request.args,false)
  assert.deepEqual({...request.args},{p_round_id:round,p_dice_count:3,p_dice_sides:6,p_modifier:2,
    p_client_request_id:request.args.p_client_request_id,p_expected_active_character_id:other})
  request.resolve({data:confirmedDice(request),error:null})
  assert.equal(await pending,true);assert.equal(synced,1)
  assert.equal(f.h.render().text,'Ich untersuche die Tür')
  f.h.cleanup()
})

test('each successful reroll is new while an ambiguous retry of the same source reuses its request ID',async()=>{
  const f=sendSetup(),dice={diceCount:3,diceSides:6,modifier:2}
  let pending=f.h.render().sendReroll('message-A',dice),first=f.b.requests[0]
  first.resolve({data:confirmedDice(first),error:null});assert.equal(await pending,true)
  pending=f.h.render().sendReroll('message-A',dice)
  const second=f.b.requests[1]
  assert.notEqual(second.args.p_client_request_id,first.args.p_client_request_id)
  second.reject(Error('network lost'));assert.equal(await pending,false)
  pending=f.h.render().sendReroll('message-A',dice)
  const retry=f.b.requests[2]
  assert.equal(retry.args.p_client_request_id,second.args.p_client_request_id)
  retry.resolve({data:confirmedDice(retry),error:null});assert.equal(await pending,true)
  f.h.cleanup()
})

test('reroll source message distinguishes equal dice intents after an ambiguous failure',async()=>{
  const f=sendSetup(),dice={diceCount:3,diceSides:6,modifier:2}
  const failed=f.h.render().sendReroll('message-A',dice),original=f.b.requests[0]
  original.reject(Error('timeout'));assert.equal(await failed,false)
  const next=f.h.render().sendReroll('message-B',dice),replacement=f.b.requests[1]
  assert.notEqual(replacement.args.p_client_request_id,original.args.p_client_request_id)
  assert.equal('sourceMessageId' in replacement.args,false)
  replacement.resolve({data:confirmedDice(replacement),error:null});assert.equal(await next,true)
  f.h.cleanup()
})

test('reroll identity changes replace ambiguous attempts with the current speaker identity',async()=>{
  const gm=gmSenderSetup(),dice={diceCount:3,diceSides:6,modifier:2}
  const failed=gm.render().composer.sendReroll('message-A',dice),original=gm.b.requests[0]
  assert.equal(original.args.p_expected_active_character_id,other)
  original.reject(Error('timeout'));assert.equal(await failed,false)

  canonicalSpeaker(gm,null)
  const retried=gm.render().composer.sendReroll('message-A',dice),narration=gm.b.requests[1]
  assert.equal(narration.args.p_expected_active_character_id,null)
  assert.notEqual(narration.args.p_client_request_id,original.args.p_client_request_id)
  narration.resolve({data:confirmedDice(narration,{speaker_kind:'game_master',speaker_name_snapshot:'Spielleitung',character_id:null}),error:null})
  assert.equal(await retried,true);gm.h.cleanup()
})

test('reroll keeps ambiguous contract failures retryable and releases definitive rejections',async()=>{
  const f=sendSetup(),dice={diceCount:2,diceSides:10,modifier:-2}
  f.h.render().setText('Draft bleibt auch bei Fehlern')
  let pending=f.h.render().sendReroll('message-A',dice),contractFailure=f.b.requests[0]
  contractFailure.resolve({data:chatMessage(101,{client_request_id:contractFailure.args.p_client_request_id}),error:null})
  assert.equal(await pending,false);assert.equal(f.h.render().text,'Draft bleibt auch bei Fehlern')
  pending=f.h.render().sendReroll('message-A',dice)
  const contractRetry=f.b.requests[1]
  assert.equal(contractRetry.args.p_client_request_id,contractFailure.args.p_client_request_id)
  contractRetry.resolve({data:null,error:{message:'DICE_INVALID_PARAMETERS'}});assert.equal(await pending,false)
  assert.equal(f.h.render().text,'Draft bleibt auch bei Fehlern')
  pending=f.h.render().sendReroll('message-A',dice)
  const afterRejection=f.b.requests[2]
  assert.notEqual(afterRejection.args.p_client_request_id,contractRetry.args.p_client_request_id)
  afterRejection.resolve({data:confirmedDice(afterRejection),error:null});assert.equal(await pending,true)
  f.h.cleanup()
})

test('reroll blocks duplicate submits, shares busy state and allows another click after completion',async()=>{
  const f=sendSetup(),dice={diceCount:1,diceSides:20,modifier:0}
  const first=f.h.render().sendReroll('message-A',dice)
  assert.equal(f.h.render().isSending,true)
  assert.equal(await f.h.render().sendReroll('message-A',dice),false)
  assert.equal(await f.h.render().sendDice(dice),false)
  assert.equal(f.b.requests.length,1)
  f.b.requests[0].resolve({data:confirmedDice(f.b.requests[0]),error:null});assert.equal(await first,true)
  const next=f.h.render().sendReroll('message-A',dice)
  assert.equal(f.b.requests.length,2)
  assert.notEqual(f.b.requests[1].args.p_client_request_id,f.b.requests[0].args.p_client_request_id)
  f.b.requests[1].resolve({data:confirmedDice(f.b.requests[1]),error:null});assert.equal(await next,true)
  f.h.cleanup()
})
