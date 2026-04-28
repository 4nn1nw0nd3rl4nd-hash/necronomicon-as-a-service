export const cocSkillsList = [
  "accounting",
  "anthropology",
  "appraise",
  "archaeology",
  "charm",
  "climb",
  "credit_rating",
  "cthulhu_mythos",
  "disguise",
  "drive",
  "electrical_repair",
  "fast_talk",
  "fighting",
  "firearms",
  "first_aid",
  "history",
  "intimidate",
  "jump",
  "language_own",
  "language_other",
  "law",
  "library_use",
  "listen",
  "locksmith",
  "mechanical_repair",
  "medicine",
  "natural_world",
  "navigate",
  "occult",
  "operate_heavy_machinery",
  "persuade",
  "pilot",
  "psychology",
  "psychoanalysis",
  "ride",
  "science",
  "sleight_of_hand",
  "spot_hidden",
  "stealth",
  "survival",
  "swim",
  "throw",
  "track",
];

export const cocSkillLabels = {
  accounting: "Buchhaltung",
  anthropology: "Anthropologie",
  appraise: "Bewerten",
  archaeology: "Archaeologie",
  charm: "Charme",
  climb: "Klettern",
  credit_rating: "Kreditwuerdigkeit",
  cthulhu_mythos: "Cthulhu-Mythos",
  disguise: "Verkleiden",
  drive: "Fahren",
  electrical_repair: "Elektroreparatur",
  fast_talk: "Ueberreden",
  fighting: "Handgemenge",
  firearms: "Feuerwaffen",
  first_aid: "Erste Hilfe",
  history: "Geschichte",
  intimidate: "Einschuechtern",
  jump: "Springen",
  language_own: "Muttersprache",
  language_other: "Fremdsprache",
  law: "Rechtskunde",
  library_use: "Bibliotheksnutzung",
  listen: "Zuhoeren",
  locksmith: "Schloesser oeffnen",
  mechanical_repair: "Mechanik",
  medicine: "Medizin",
  natural_world: "Naturkunde",
  navigate: "Navigation",
  occult: "Okkultismus",
  operate_heavy_machinery: "Schwere Maschinen",
  persuade: "Ueberzeugen",
  pilot: "Pilot",
  psychology: "Psychologie",
  psychoanalysis: "Psychoanalyse",
  ride: "Reiten",
  science: "Naturwissenschaft",
  sleight_of_hand: "Fingerfertigkeit",
  spot_hidden: "Verborgenes erkennen",
  stealth: "Schleichen",
  survival: "Ueberleben",
  swim: "Schwimmen",
  throw: "Werfen",
  track: "Faehrtenlesen",
};

export function createEmptyCoCCharacter() {
  const character = {
    id: null,
    name: "",
    played_by: "",
    profession: "",
    birthdate: null,
    age: null,
    gender: "",
    residence: "",
    birthplace: "",
    str: 50,
    dex: 50,
    con: 50,
    siz: 50,
    intell: 50,
    app: 50,
    pow: 50,
    edu: 50,
    mov: 8,
    hitpoints: null,
    sanity: null,
    luck: null,
    magic_points: null,
    custom_skill_name: "",
    custom_skill_value: null,
    background: "",
    important_people: "",
    important_places: "",
    dodge: 0,
    melee: 25,
    firearm_malfunction: 0,
    ranged_firearm: 20,
    rifle_shotgun: 25,
  };

  cocSkillsList.forEach((skill) => {
    character[skill] = 0;
  });

  return character;
}

export function calculateCoCDerived(character) {
  const str = Number(character.str) || 0;
  const dex = Number(character.dex) || 0;
  const con = Number(character.con) || 0;
  const siz = Number(character.siz) || 0;
  const pow = Number(character.pow) || 0;

  let mov = 8;
  if (dex > siz && str > siz) mov = 9;
  if (dex < siz && str < siz) mov = 7;

  return {
    hitpoints: Math.floor((con + siz) / 10),
    sanity: pow,
    luck: pow,
    magic_points: Math.floor(pow / 5),
    mov,
  };
}

export function getCoCSkillLabel(skill) {
  return cocSkillLabels[skill] || skill.replaceAll("_", " ");
}
