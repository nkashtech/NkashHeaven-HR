import { Plus, Trash2 } from 'lucide-react'
import { Field } from './ui'

const select = (...options) => ({ options })
const COUNTRIES = ['South Africa', 'Botswana', 'DR Congo', 'Eswatini', 'Gabon', 'Kenya', 'Lesotho', 'Mozambique', 'Namibia', 'Nigeria', 'Zambia', 'Zimbabwe', 'Other']
const BANKS = ['Absa', 'Capitec', 'Discovery Bank', 'FNB', 'Investec', 'Nedbank', 'Standard Bank', 'TymeBank']

const NATIONALITIES = ['South African', 'Motswana', 'Congolese', 'Swazi', 'Gabonese', 'Kenyan', 'Mosotho', 'Mozambican', 'Namibian', 'Nigerian', 'Zambian', 'Zimbabwean']
const RELIGIONS = ['Christianity', 'Islam', 'Hinduism', 'Judaism', 'African Traditional', 'None']
const RELATIONS = ['Spouse', 'Partner', 'Mother', 'Father', 'Brother', 'Sister', 'Son', 'Daughter', 'Friend']
const PROVINCES = {
  Johannesburg: 'Gauteng', Pretoria: 'Gauteng', Sandton: 'Gauteng', Soweto: 'Gauteng', Midrand: 'Gauteng', Centurion: 'Gauteng', 'Cape Town': 'Western Cape', Stellenbosch: 'Western Cape', George: 'Western Cape',
  Durban: 'KwaZulu-Natal', Pietermaritzburg: 'KwaZulu-Natal', Gqeberha: 'Eastern Cape', 'East London': 'Eastern Cape', Bloemfontein: 'Free State', Polokwane: 'Limpopo', Mbombela: 'Mpumalanga', Kimberley: 'Northern Cape', Rustenburg: 'North West',
}
const CITIES = Object.keys(PROVINCES)
const suggest = (...suggestions) => ({ suggestions })

// One definition of an employee record, shared by HR's form and My Profile.
export const SECTIONS = [
  {
    key: 'personal', label: 'Personal information',
    fields: [
      ['salutation', 'Salutation', select('Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.')],
      ['firstName', 'First name', { sensitive: true, selfOnly: true, name: true }], ['middleName', 'Middle name', { sensitive: true, selfOnly: true, name: true }], ['lastName', 'Surname', { sensitive: true, selfOnly: true, name: true }],
      ['preferredName', 'Nickname'], ['displayName', 'Display name', { selfOnly: true, picks: true }], ['pronoun', 'Pronoun', select('He / Him', 'She / Her', 'They / Them')], ['birthDate', 'Date of birth', { type: 'date', sensitive: true }],
      ['gender', 'Gender', select('Male', 'Female', 'Other', 'Prefer not to say')], ['nationality', 'Nationality', suggest(...NATIONALITIES)],
      ['bloodGroup', 'Blood group', select('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')], ['religion', 'Religion', suggest(...RELIGIONS)],
      ['race', 'Race', select('African', 'Coloured', 'Indian', 'White', 'Other')], ['maritalStatus', 'Marital status', select('Single', 'Married', 'Divorced', 'Widowed')],
      ['idNumber', 'Government ID', { sensitive: true, autoHint: 'A South African ID fills in date of birth, gender and nationality.' }], ['idExpiry', 'Government ID expiry date', { type: 'date' }],
      ['taxNumber', 'Tax number', { sensitive: true }], ['passportNumber', 'Passport number', { sensitive: true }], ['permitExpiry', 'Permit expiry date', { type: 'date' }],
    ],
  },
  {
    key: 'contact', label: 'Contact information',
    groups: [
      ['Permanent address', [['address', 'Address', { wide: true }], ['city', 'City', suggest(...CITIES)], ['state', 'State / province'], ['zipCode', 'Zip code'], ['country', 'Country', select(...COUNTRIES)], ['contactNumber', 'Contact number']]],
      ['Present address', [['presentAddress', 'Address', { wide: true }], ['presentCity', 'City', suggest(...CITIES)], ['presentState', 'State / province'], ['presentZip', 'Zip code'], ['presentCountry', 'Country', select(...COUNTRIES)], ['presentContact', 'Contact number']]],
      ['Phone numbers', [['homePhone', 'Home phone'], ['officePhone', 'Office phone'], ['phone', 'Mobile phone'], ['personalEmail', 'Personal email', { type: 'email' }]]],
    ],
  },
  {
    key: 'emergency', label: 'Emergency contact',
    fields: [['emergencyName', 'Emergency contact person'], ['emergencyRelation', 'Relationship', suggest(...RELATIONS)], ['emergencyPhone', 'Phone number'], ['emergencyEmail', 'Email address', { type: 'email' }]],
  },
  {
    key: 'bank', label: 'Bank account',
    fields: [['bankName', 'Bank', { ...select(...BANKS), sensitive: true }], ['bankAccount', 'Account number', { sensitive: true }], ['bankAccountType', 'Account type', { ...select('Savings', 'Cheque', 'Transmission'), sensitive: true }]],
  },
  { key: 'dependents', label: 'Dependents', list: 'dependents', columns: [['name', 'Name'], ['relation', 'Relationship'], ['birthDate', 'Date of birth', 'date']] },
  { key: 'experience', label: 'Work experience', list: 'workExperience', columns: [['company', 'Company'], ['title', 'Job title'], ['from', 'From', 'date'], ['to', 'To', 'date']] },
  { key: 'qualifications', label: 'Qualifications', list: 'qualifications', columns: [['name', 'Qualification'], ['institution', 'Institution'], ['year', 'Year']] },
  { key: 'memberships', label: 'Memberships', list: 'memberships', columns: [['name', 'Organisation'], ['number', 'Member number'], ['expires', 'Expires', 'date']] },
]

// "elvis boka" becomes "Elvis Boka". Anything already mixed case, like "van der Merwe" or "McDonald", is left alone.
export const properName = (s) => (s && (s === s.toLowerCase() || s === s.toUpperCase()) ? s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase()) : s)

// The date, sex and citizenship inside a valid 13-digit South African ID number.
export function readSaId(raw) {
  const id = String(raw || '').replace(/\s/g, '')
  if (!/^\d{13}$/.test(id)) return null
  const sum = [...id].reduce((total, d, i) => { const n = Number(d) * (i % 2 ? 2 : 1); return total + (n > 9 ? n - 9 : n) }, 0)
  if (sum % 10) return null
  const yy = Number(id.slice(0, 2))
  const year = yy > new Date().getFullYear() % 100 ? 1900 + yy : 2000 + yy
  const birthDate = `${year}-${id.slice(2, 4)}-${id.slice(4, 6)}`
  if (Number.isNaN(Date.parse(birthDate))) return null
  return { birthDate, gender: Number(id.slice(6, 10)) >= 5000 ? 'Male' : 'Female', nationality: id[10] === '0' ? 'South African' : '' }
}

const SALUTATION = { 'Mr.': ['Male', 'He / Him'], 'Mrs.': ['Female', 'She / Her'], 'Ms.': ['Female', 'She / Her'] }
const PRONOUN = { Male: 'He / Him', Female: 'She / Her' }

// What one edit can fill in for the person. It only ever fills empty fields, so nothing they typed is replaced.
function autofill(value, key, typed) {
  const next = { ...value, [key]: typed }
  const fill = (k, v) => { if (v && !next[k]) next[k] = v }
  if (key === 'idNumber') {
    const found = readSaId(typed)
    if (found) { fill('birthDate', found.birthDate); fill('gender', found.gender); fill('nationality', found.nationality); fill('pronoun', PRONOUN[found.gender]) }
  }
  if (key === 'salutation' && SALUTATION[typed]) { fill('gender', SALUTATION[typed][0]); fill('pronoun', SALUTATION[typed][1]) }
  if (key === 'gender') fill('pronoun', PRONOUN[typed])
  if (key === 'city' && PROVINCES[typed]) { fill('state', PROVINCES[typed]); fill('country', 'South Africa') }
  if (key === 'presentCity' && PROVINCES[typed]) { fill('presentState', PROVINCES[typed]); fill('presentCountry', 'South Africa') }
  // The contact number follows the mobile until someone gives it its own value.
  if (key === 'phone' && (!value.contactNumber || value.contactNumber === value.phone)) next.contactNumber = typed
  return next
}

const ADDRESS = [['address', 'presentAddress'], ['city', 'presentCity'], ['state', 'presentState'], ['zipCode', 'presentZip'], ['country', 'presentCountry'], ['contactNumber', 'presentContact']]
const sameAddress = (value) => Object.fromEntries(ADDRESS.map(([from, to]) => [to, value[from] || '']))

function ListEditor({ section, value, onChange, disabled }) {
  const rows = value[section.list] || []
  const set = (i, k, v) => onChange({ ...value, [section.list]: rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) })
  return (
    <div className="space-y-2">
      {!rows.length && <p className="text-[13px] text-ink-muted">Nothing added yet.</p>}
      {rows.map((r, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={i} className="flex flex-wrap items-end gap-2 rounded-xl border border-line p-2">
          {section.columns.map(([k, label, type]) => (
            <div key={k} className="min-w-[120px] flex-1"><Field label={label}><input type={type || 'text'} disabled={disabled} className="input" value={r[k] || ''} onChange={(e) => set(i, k, e.target.value)} /></Field></div>
          ))}
          {!disabled && <button type="button" className="btn-outline !p-2" aria-label="Remove row" onClick={() => onChange({ ...value, [section.list]: rows.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>}
        </div>
      ))}
      {!disabled && <button type="button" className="btn-outline" onClick={() => onChange({ ...value, [section.list]: [...rows, {}] })}><Plus size={14} />Add</button>}
    </div>
  )
}

function Input({ spec, value, masks, onChange, mode }) {
  const [key, label, opts = {}] = spec
  if (opts.picks) return <div><DisplayName value={value} onChange={onChange} /></div>
  const set = (e) => onChange(autofill(value, key, e.target.value))
  const tidy = () => { if (opts.name) onChange({ ...value, [key]: properName(value[key]) }) }
  const hint = [opts.autoHint, opts.sensitive && mode === 'self' ? 'Changes need HR approval' : ''].filter(Boolean).join(' ') || undefined
  const body = opts.options
    ? <select className="input" value={value[key] || ''} onChange={set}><option value="">Choose</option>{opts.options.map((o) => <option key={o}>{o}</option>)}</select>
    : <input type={opts.type || 'text'} className="input" autoComplete="off" placeholder={masks?.[key] || ''} list={opts.suggestions && `${key}-list`} value={value[key] || ''} onChange={set} onBlur={tidy} />
  return <div className={opts.wide ? 'sm:col-span-2' : ''}><Field label={label} hint={hint}>{body}{opts.suggestions && <datalist id={`${key}-list`}>{opts.suggestions.map((o) => <option key={o} value={o} />)}</datalist>}</Field></div>
}

// The ways someone's own names can be shown. They appear on every screen except payslips, which keep the full name.
function nameChoices({ firstName, middleName, lastName, preferredName }) {
  const join = (...parts) => parts.filter(Boolean).join(' ')
  return [...new Set([join(firstName, lastName), join(middleName, lastName), join(preferredName, lastName), join(firstName), join(middleName), join(preferredName)].filter((n) => n && n !== join(firstName, middleName, lastName)))]
}

function DisplayName({ value, onChange }) {
  const full = [value.firstName, value.middleName, value.lastName].filter(Boolean).join(' ')
  return (
    <Field label="Display name" hint="What others see you as. Payslips keep your full name.">
      <select className="input" value={value.displayName || ''} onChange={(e) => onChange({ ...value, displayName: e.target.value })}>
        <option value="">{full || 'Full name'}</option>
        {nameChoices(value).map((n) => <option key={n}>{n}</option>)}
      </select>
    </Field>
  )
}

// masks: already-saved secrets shown as a placeholder, so the real value never reaches the form.
export function SectionFields({ section, value, onChange, masks, mode }) {
  if (section.list) return <ListEditor section={section} value={value} onChange={onChange} />
  const grid = (fields) => <div className="grid gap-3 sm:grid-cols-2">{fields.filter((f) => !(f[2]?.selfOnly && mode === 'hr')).map((f) => <Input key={f[0]} spec={f} value={value} masks={masks} onChange={onChange} mode={mode} />)}</div>
  if (section.groups) return <div className="space-y-5">{section.groups.map(([title, fields]) => <div key={title}><div className="mb-2 flex items-center justify-between gap-3"><h4 className="text-[13px] font-bold">{title}</h4>{title === 'Present address' && <button type="button" className="btn-outline btn-sm" onClick={() => onChange({ ...value, ...sameAddress(value) })}>Same as permanent address</button>}</div>{grid(fields)}</div>)}</div>
  return grid(section.fields)
}

const ALL_KEYS = SECTIONS.flatMap((s) => (s.list ? [s.list] : [...(s.fields || []), ...(s.groups || []).flatMap((g) => g[1])].map((f) => f[0])))
const MASKED = ['idNumber', 'taxNumber', 'passportNumber', 'bankAccount']

// A saved profile as editable values. Masked numbers stay blank and only change if retyped.
export function toForm(p) {
  const out = {}
  ALL_KEYS.forEach((k) => { out[k] = MASKED.includes(k) ? '' : (p[k] ?? '') })
  SECTIONS.filter((s) => s.list).forEach((s) => { out[s.list] = p[s.list] || [] })
  return out
}
export const masksOf = (p) => Object.fromEntries(MASKED.map((k) => [k, p[k] || '']))
