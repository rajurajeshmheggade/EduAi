/* Built-in subject vocabulary for Concept Pairs and Word Forge: short, school-level terms with one-line meanings
   (kept short so a card fits on a phone). No AI call — the student's own subjects (from the Wellness academic
   context) choose which packs are offered, with a general study pack when none of their subjects has one. */

export interface VocabEntry { term: string; def: string }
export interface VocabPack { id: string; label: string; match: RegExp; entries: readonly VocabEntry[] }
/** A choice on a game's start screen: one pack, labelled with the student's own subject name where possible. */
export interface VocabTopic { id: string; label: string }

const e = (term: string, def: string): VocabEntry => ({ term, def })

// Order matters: the first pack whose pattern matches a subject wins, so 'Social Science' and 'Computer Science'
// are claimed before the general Science pack.
export const VOCAB_PACKS: readonly VocabPack[] = [
  {
    id: 'maths', label: 'Mathematics', match: /math|algebra|geometry|arithmetic|statistic/i,
    entries: [
      e('Integer', 'A whole number or its negative'),
      e('Prime', 'Has exactly two factors: 1 and itself'),
      e('Fraction', 'Part of a whole, like 3/4'),
      e('Perimeter', 'Distance around a flat shape'),
      e('Area', 'Space inside a flat shape'),
      e('Volume', 'Space a solid takes up'),
      e('Radius', 'Centre of a circle to its edge'),
      e('Diameter', 'Chord through the centre of a circle'),
      e('Hypotenuse', 'Longest side of a right triangle'),
      e('Median', 'Middle value of ordered data'),
      e('Mode', 'Most frequent value in a data set'),
      e('Variable', 'A letter standing for a number'),
      e('Equation', 'Statement that two sides are equal'),
      e('Polygon', 'Closed shape with straight sides'),
      e('Ratio', 'Compares two quantities, like 2 : 3'),
      e('Exponent', 'How many times a base is multiplied'),
      e('Parallel', 'Lines that never meet'),
    ],
  },
  {
    id: 'physics', label: 'Physics', match: /physic/i,
    entries: [
      e('Velocity', 'Speed in a given direction'),
      e('Force', 'A push or a pull'),
      e('Inertia', 'Resistance to a change in motion'),
      e('Friction', 'Force that opposes sliding'),
      e('Gravity', 'Pull of masses towards each other'),
      e('Energy', 'The capacity to do work'),
      e('Momentum', 'Mass multiplied by velocity'),
      e('Current', 'Flow of electric charge'),
      e('Voltage', 'Push that drives a current'),
      e('Resistance', 'Opposition to the flow of current'),
      e('Refraction', 'Light bending between materials'),
      e('Reflection', 'Light bouncing off a surface'),
      e('Frequency', 'Waves passing a point each second'),
      e('Pressure', 'Force per unit area'),
      e('Joule', 'SI unit of energy'),
      e('Newton', 'SI unit of force'),
    ],
  },
  {
    id: 'chemistry', label: 'Chemistry', match: /chem/i,
    entries: [
      e('Atom', 'Smallest unit of an element'),
      e('Molecule', 'Two or more atoms bonded together'),
      e('Element', 'Substance made of one kind of atom'),
      e('Compound', 'Elements chemically combined'),
      e('Mixture', 'Substances mixed but not bonded'),
      e('Isotope', 'Same element, different neutrons'),
      e('Catalyst', 'Speeds a reaction, is not used up'),
      e('Acid', 'Turns blue litmus red'),
      e('Base', 'Turns red litmus blue'),
      e('Valency', 'Combining capacity of an atom'),
      e('Electron', 'Negative particle around a nucleus'),
      e('Proton', 'Positive particle in the nucleus'),
      e('Neutron', 'Particle with no charge in the nucleus'),
      e('Alloy', 'A metal mixed with other elements'),
      e('Solvent', 'Liquid that dissolves a solute'),
      e('Oxidation', 'Gain of oxygen or loss of electrons'),
    ],
  },
  {
    id: 'biology', label: 'Biology', match: /bio|life science|botany|zoology/i,
    entries: [
      e('Cell', 'Basic unit of life'),
      e('Nucleus', "Cell's control centre, holds DNA"),
      e('Mitochondria', 'Release energy in a cell'),
      e('Chlorophyll', 'Green pigment that traps light'),
      e('Enzyme', 'Protein that speeds up reactions'),
      e('Osmosis', 'Water moving through a membrane'),
      e('Habitat', 'Natural home of an organism'),
      e('Neuron', 'Nerve cell that carries signals'),
      e('Hormone', 'Chemical messenger in the blood'),
      e('Gene', 'Unit of heredity on DNA'),
      e('Tissue', 'Group of similar cells'),
      e('Stomata', 'Leaf pores for gas exchange'),
      e('Respiration', 'Releasing energy from food'),
      e('Ecosystem', 'Living things and their surroundings'),
      e('Vaccine', 'Trains the body to fight a germ'),
      e('Photosynthesis', 'Plants making food using light'),
    ],
  },
  {
    id: 'english', label: 'English', match: /english|literature|grammar|language/i,
    entries: [
      e('Noun', 'A naming word'),
      e('Verb', 'An action or being word'),
      e('Adjective', 'Describes a noun'),
      e('Adverb', 'Describes a verb'),
      e('Pronoun', 'Used in place of a noun'),
      e('Synonym', 'Word with a similar meaning'),
      e('Antonym', 'Word with the opposite meaning'),
      e('Simile', "Comparison using 'like' or 'as'"),
      e('Metaphor', "Says one thing is another"),
      e('Idiom', 'Phrase whose meaning is not literal'),
      e('Prefix', 'Letters added to the start of a word'),
      e('Suffix', 'Letters added to the end of a word'),
      e('Alliteration', 'Repeated starting sounds'),
      e('Narrator', 'The voice that tells a story'),
      e('Plot', 'The events of a story in order'),
      e('Tense', 'Shows when an action happens'),
    ],
  },
  {
    id: 'social', label: 'Social Science', match: /social|history|geograph|civics|political|economic/i,
    entries: [
      e('Democracy', 'Government by the people'),
      e('Constitution', "A country's supreme law"),
      e('Latitude', 'Distance north or south of the equator'),
      e('Longitude', 'Distance east or west of Greenwich'),
      e('Monsoon', 'Seasonal winds that bring rain'),
      e('Census', 'Official count of the population'),
      e('Plateau', 'Raised area of flat land'),
      e('Delta', "Landform at a river's mouth"),
      e('Federalism', 'Power shared by centre and states'),
      e('Monarchy', 'Rule by a king or queen'),
      e('Colony', 'Land ruled by another country'),
      e('Erosion', 'Wearing away of land'),
      e('Equator', 'Line between the two hemispheres'),
      e('Parliament', "A nation's law-making body"),
      e('Budget', 'Plan of income and spending'),
    ],
  },
  {
    id: 'computer', label: 'Computer Science', match: /computer|informatics|\bit\b|coding|programming/i,
    entries: [
      e('Algorithm', 'Step-by-step method to solve a task'),
      e('Variable', 'Named store for a value'),
      e('Loop', 'Repeats a set of instructions'),
      e('Bug', 'An error in a program'),
      e('Compiler', 'Turns source code into machine code'),
      e('Pixel', 'Smallest dot on a screen'),
      e('Binary', 'Number system of 0s and 1s'),
      e('Byte', 'A group of eight bits'),
      e('Browser', 'App for viewing web pages'),
      e('Database', 'Organised store of data'),
      e('Function', 'Named, reusable block of code'),
      e('Network', 'Linked computers sharing data'),
      e('Cursor', 'Marker showing where you type'),
      e('Router', 'Directs data between networks'),
      e('Encryption', 'Scrambling data to keep it secret'),
    ],
  },
  {
    id: 'science', label: 'Science', match: /science|evs|environment/i,
    entries: [
      e('Evaporation', 'Liquid turning into vapour'),
      e('Condensation', 'Vapour turning into liquid'),
      e('Magnet', 'Attracts iron and steel'),
      e('Germination', 'A seed starting to grow'),
      e('Fossil', 'Preserved remains of ancient life'),
      e('Orbit', 'Path of one body around another'),
      e('Shadow', 'Dark area where light is blocked'),
      e('Habitat', 'Natural home of a living thing'),
      e('Predator', 'Animal that hunts others for food'),
      e('Mineral', 'Natural solid found in rocks'),
      e('Lever', 'Bar that turns on a pivot'),
      e('Vapour', 'Gas form of a liquid'),
      e('Pollination', 'Pollen carried to a flower'),
      e('Climate', 'Usual weather over many years'),
      e('Nutrient', 'Substance the body needs from food'),
    ],
  },
]

/** Always offered: calm study words, for students whose subjects have no pack yet. */
export const GENERAL_PACK: VocabPack = {
  id: 'general', label: 'Study & wellbeing', match: /$^/,
  entries: [
    e('Focus', 'Attention on one thing at a time'),
    e('Rest', 'Time to recharge'),
    e('Resilience', 'Bouncing back from setbacks'),
    e('Revision', 'Going over what you learnt'),
    e('Mindful', 'Aware of the present moment'),
    e('Goal', 'Something you aim to achieve'),
    e('Habit', 'Something you do regularly'),
    e('Gratitude', 'Feeling thankful'),
    e('Patience', 'Staying calm while you wait'),
    e('Curious', 'Eager to learn and explore'),
    e('Courage', 'Acting even when afraid'),
    e('Balance', 'A fair share of work and rest'),
    e('Hydrate', 'Drink enough water'),
    e('Breathe', 'Take air slowly in and out'),
  ],
}

const ALL_PACKS = [...VOCAB_PACKS, GENERAL_PACK]
export const MIXED_TOPIC = 'mixed'

/** The pack for a subject name ("Physics", "Maths – II", "Social Studies"…), or undefined. */
export const packForSubject = (subject: string): VocabPack | undefined => VOCAB_PACKS.find((p) => p.match.test(subject))

/**
 * Start-screen topics for a student: one per subject that has a pack (labelled with their own subject name), then
 * "Mixed" (all their packs) when there are two or more, then the general study pack. A student whose subjects have
 * no pack gets Mathematics, Science and English as well, so there is always some choice.
 */
export function vocabTopics(subjects: readonly string[]): VocabTopic[] {
  const out: VocabTopic[] = []
  for (const s of subjects) {
    const p = packForSubject(s)
    if (p && !out.some((t) => t.id === p.id)) out.push({ id: p.id, label: s })
  }
  if (!out.length) for (const id of ['maths', 'science', 'english']) out.push({ id, label: ALL_PACKS.find((p) => p.id === id)!.label })
  if (out.length > 1) out.push({ id: MIXED_TOPIC, label: 'Mixed' })
  out.push({ id: GENERAL_PACK.id, label: GENERAL_PACK.label })
  return out
}

/** The entries for a topic. "Mixed" draws on every pack in `topics`, with duplicate terms removed. */
export function vocabFor(topicId: string, topics: readonly VocabTopic[] = []): VocabEntry[] {
  const ids = topicId === MIXED_TOPIC ? topics.map((t) => t.id).filter((id) => id !== MIXED_TOPIC && id !== GENERAL_PACK.id) : [topicId]
  const seen = new Set<string>()
  const out: VocabEntry[] = []
  for (const id of ids) {
    for (const entry of ALL_PACKS.find((p) => p.id === id)?.entries ?? []) {
      const key = entry.term.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(entry)
    }
  }
  return out.length ? out : [...GENERAL_PACK.entries]
}

/** The topic to preselect: the subject that needs most support if it has a pack, else the first topic. */
export function defaultTopic(topics: readonly VocabTopic[], needsSupport: string | null | undefined): string {
  const p = needsSupport ? packForSubject(needsSupport) : undefined
  return (p && topics.some((t) => t.id === p.id) ? p.id : topics[0]?.id) ?? GENERAL_PACK.id
}
