import { Plus, Trash2 } from 'lucide-react'
import { Field } from './ui'

const select = (...options) => ({ options })
const COUNTRIES = ['South Africa', 'Botswana', 'DR Congo', 'Eswatini', 'Gabon', 'Kenya', 'Lesotho', 'Mozambique', 'Namibia', 'Nigeria', 'Zambia', 'Zimbabwe', 'Other']
const BANKS = ['Absa', 'Capitec', 'Discovery Bank', 'FNB', 'Investec', 'Nedbank', 'Standard Bank', 'TymeBank']

// One definition of an employee record, shared by HR's form and My Profile.
export const SECTIONS = [
  {
    key: 'personal', label: 'Personal information',
    fields: [
      ['salutation', 'Salutation', select('Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.')], ['preferredName', 'Nick name'],
      ['pronoun', 'Pronoun', select('He / Him', 'She / Her', 'They / Them')], ['birthDate', 'Date of birth', { type: 'date', sensitive: true }],
      ['gender', 'Gender', select('Male', 'Female', 'Other', 'Prefer not to say')], ['nationality', 'Nationality'],
      ['bloodGroup', 'Blood group', select('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')], ['religion', 'Religion'],
      ['race', 'Race', select('African', 'Coloured', 'Indian', 'White', 'Other')], ['maritalStatus', 'Marital status', select('Single', 'Married', 'Divorced', 'Widowed')],
      ['idNumber', 'Government ID', { sensitive: true }], ['idExpiry', 'Government ID expiry date', { type: 'date' }],
      ['taxNumber', 'Tax number', { sensitive: true }], ['passportNumber', 'Passport number', { sensitive: true }], ['permitExpiry', 'Permit expiry date', { type: 'date' }],
    ],
  },
  {
    key: 'contact', label: 'Contact information',
    groups: [
      ['Permanent address', [['address', 'Address', { wide: true }], ['city', 'City'], ['state', 'State / province'], ['zipCode', 'Zip code'], ['country', 'Country', select(...COUNTRIES)], ['contactNumber', 'Contact number']]],
      ['Present address', [['presentAddress', 'Address', { wide: true }], ['presentCity', 'City'], ['presentState', 'State / province'], ['presentZip', 'Zip code'], ['presentCountry', 'Country', select(...COUNTRIES)], ['presentContact', 'Contact number']]],
      ['Phone numbers', [['homePhone', 'Home phone'], ['officePhone', 'Office phone'], ['phone', 'Mobile phone'], ['personalEmail', 'Personal email', { type: 'email' }]]],
    ],
  },
  {
    key: 'emergency', label: 'Emergency contact',
    fields: [['emergencyName', 'Emergency contact person'], ['emergencyRelation', 'Relationship'], ['emergencyPhone', 'Phone number'], ['emergencyEmail', 'Email address', { type: 'email' }]],
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
  const set = (e) => onChange({ ...value, [key]: e.target.value })
  const hint = opts.sensitive && mode === 'self' ? 'Changes need HR approval' : undefined
  const body = opts.options
    ? <select className="input" value={value[key] || ''} onChange={set}><option value="">Choose</option>{opts.options.map((o) => <option key={o}>{o}</option>)}</select>
    : <input type={opts.type || 'text'} className="input" autoComplete="off" placeholder={masks?.[key] || ''} value={value[key] || ''} onChange={set} />
  return <div className={opts.wide ? 'sm:col-span-2' : ''}><Field label={label} hint={hint}>{body}</Field></div>
}

// masks: already-saved secrets shown as a placeholder, so the real value never reaches the form.
export function SectionFields({ section, value, onChange, masks, mode }) {
  if (section.list) return <ListEditor section={section} value={value} onChange={onChange} />
  const grid = (fields) => <div className="grid gap-3 sm:grid-cols-2">{fields.map((f) => <Input key={f[0]} spec={f} value={value} masks={masks} onChange={onChange} mode={mode} />)}</div>
  if (section.groups) return <div className="space-y-5">{section.groups.map(([title, fields]) => <div key={title}><h4 className="mb-2 text-[13px] font-bold">{title}</h4>{grid(fields)}</div>)}</div>
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
