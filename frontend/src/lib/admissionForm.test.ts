import { describe, expect, it } from 'vitest'
import {
  CORE, accentVars, definitionProblems, documentProblems, fileProblem, gradeLabel, keyFrom, newField, sectionProgress, validateAnswers,
  validateField, type FieldDef, type FormDefinition,
} from './admissionForm'

const dob = (years: number) => {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years)
  d.setDate(d.getDate() - 20)
  return d.toISOString().slice(0, 10)
}
const f = (key: string, type: FieldDef['type'], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label: key, type, ...extra })

const DEF: FormDefinition = {
  instructions: 'Keep documents ready.',
  declaration: 'I confirm the details are true.',
  sections: [
    { key: 'student', title: 'Student', kind: 'student', fields: [
      f('student_name', 'text', { core: 'student_name' }), f('date_of_birth', 'date', { core: 'date_of_birth' }),
      f('grade_applying', 'grade', { core: 'grade_applying' }), f('home_address', 'textarea', { required: true, max_length: 50 })] },
    { key: 'guardian', title: 'Guardian', kind: 'guardian', fields: [
      f('guardian_name', 'text', { core: 'guardian_name' }), f('guardian_relationship', 'select', { core: 'guardian_relationship', options: ['Mother', 'Father', 'Guardian'] }),
      f('guardian_phone', 'phone', { core: 'guardian_phone' }), f('guardian_email', 'email', { core: 'guardian_email' }),
      f('percentage', 'number', { min: 0, max: 100 }), f('transport', 'checkbox')] },
  ],
  documents: [{ key: 'birth_certificate', label: 'Birth certificate', required: true, accept: ['pdf', 'jpg'], max_mb: 2, max_files: 1 },
    { key: 'report', label: 'Report card', accept: ['pdf'], max_mb: 5, max_files: 2 }],
}

describe('admission form definitions', () => {
  it('derives stable unique keys from labels', () => {
    expect(keyFrom("Mother's Occupation", [])).toBe('mother_s_occupation')
    expect(keyFrom('Name', ['name'])).toBe('name_2')
    expect(keyFrom('123 Street', [])).toMatch(/^f_123_street/)
    expect(keyFrom('!', [])).toBe('field')
    expect(newField('select', 'Blood group', ['blood_group'])).toMatchObject({ key: 'blood_group_2', options: ['Option 1', 'Option 2'] })
  })

  it('reports structural problems and, when publishing, missing core fields', () => {
    expect(definitionProblems(DEF)).toEqual([])
    expect(definitionProblems(DEF, { publishing: true })).toEqual([])
    const broken: FormDefinition = { ...DEF, sections: [{ ...DEF.sections[0], fields: [...DEF.sections[0].fields, f('student_name', 'text'),
      f('pick', 'select', { options: ['A', 'a'] }), f('n', 'number', { min: 5, max: 1 })] }], documents: [{ ...DEF.documents[0], accept: [] }] }
    const p = definitionProblems(broken)
    expect(p.join('\n')).toMatch(/unique: student_name/)
    expect(p.join('\n')).toMatch(/repeated options/)
    expect(p.join('\n')).toMatch(/minimum is above maximum/)
    expect(p.join('\n')).toMatch(/at least one file type/)
    const noGuardian = { ...DEF, sections: [DEF.sections[0]], declaration: '' }
    const pub = definitionProblems(noGuardian, { publishing: true })
    expect(pub[0]).toBe('Add the required fields: parent / guardian name, relationship, parent / guardian phone')
    expect(pub).toContain('Add the declaration the applicant confirms before submitting')
    expect(definitionProblems(noGuardian)).toEqual([])   // a draft may be incomplete
  })

  it('validates each answer type like the server does', () => {
    const grades = [6, 7, 8]
    expect(validateField(f('x', 'text', { required: true }), '  ', grades)).toBe('This field is required')
    expect(validateField(f('x', 'text'), '', grades)).toBeNull()
    expect(validateField(CORE.student_name && f('n', 'text', { core: 'student_name' }), undefined, grades)).toBe('This field is required')
    expect(validateField(f('x', 'textarea', { max_length: 5 }), 'too long', grades)).toBe('Use at most 5 characters')
    expect(validateField(f('e', 'email'), 'a@b', grades)).toBe('Enter a valid email address')
    expect(validateField(f('e', 'email'), 'a@b.in', grades)).toBeNull()
    expect(validateField(f('p', 'phone'), 'call me', grades)).toBe('Enter a valid phone number')
    expect(validateField(f('p', 'phone'), '+91 98450-12345', grades)).toBeNull()
    expect(validateField(f('d', 'date'), '2014-13-45', grades)).toBe('Enter a valid date')
    expect(validateField(f('d', 'date', { core: 'date_of_birth' }), dob(40), grades)).toMatch(/outside 2–25 years/)
    expect(validateField(f('d', 'date', { core: 'date_of_birth' }), dob(12), grades)).toBeNull()
    expect(validateField(f('n', 'number', { min: 0, max: 100 }), '101', grades)).toBe('Must be at most 100')
    expect(validateField(f('n', 'number'), 'abc', grades)).toBe('Enter a number')
    expect(validateField(f('s', 'select', { options: ['A'] }), 'B', grades)).toBe('Choose one of the options')
    expect(validateField(f('g', 'grade'), 11, grades)).toBe('Choose one of the classes offered')
    expect(validateField(f('g', 'grade'), '7', grades)).toBeNull()
    expect(validateField(f('c', 'checkbox', { required: true }), false, grades)).toBe('This field is required')
  })

  it('checks a whole application and its documents', () => {
    const answers = { student_name: 'Riya', date_of_birth: dob(12), grade_applying: 7, home_address: 'MG Road', guardian_name: 'Neha',
      guardian_relationship: 'Mother', guardian_phone: '9845012345' }
    expect(validateAnswers(DEF, answers, [6, 7])).toEqual({})
    expect(Object.keys(validateAnswers(DEF, { ...answers, guardian_email: 'x', percentage: -1 }, [6, 7]))).toEqual(['guardian_email', 'percentage'])
    expect(Object.keys(validateAnswers(DEF, {}, [6, 7])).sort()).toEqual(
      ['date_of_birth', 'grade_applying', 'guardian_name', 'guardian_phone', 'guardian_relationship', 'home_address', 'student_name'])
    expect(sectionProgress(DEF.sections[0], { student_name: 'R' })).toEqual({ done: 1, total: 4 })
    expect(documentProblems(DEF, {})).toEqual({ birth_certificate: 'Upload this document' })
    expect(documentProblems(DEF, { birth_certificate: 1, report: 3 })).toEqual({ report: 'Upload at most 2 file(s)' })
    const bc = DEF.documents[0]
    expect(fileProblem(bc, { name: 'scan.PNG', size: 100 })).toBe('Choose a PDF / JPEG file')
    expect(fileProblem(bc, { name: 'scan.jpeg', size: 3 * 1024 * 1024 })).toBe('The file is larger than 2 MB')
    expect(fileProblem(bc, { name: 'scan.pdf', size: 0 })).toBe('The file is empty')
    expect(fileProblem(bc, { name: 'scan.pdf', size: 1000 })).toBeNull()
  })

  it('labels classes and keeps accent colours readable', () => {
    expect([-2, -1, 0, 7].map(gradeLabel)).toEqual(['Nursery', 'LKG', 'UKG', 'Class 7'])
    expect(accentVars(null)).toEqual({})
    expect(accentVars('not-a-colour')).toEqual({})
    const pale = accentVars('#ffff99') as Record<string, string>
    expect(pale['--color-brand-500']).toMatch(/ 42%\)$/)          // clamped dark enough for white text
    const dark = accentVars('#000033') as Record<string, string>
    expect(dark['--color-brand-500']).toMatch(/ 22%\)$/)
  })
})
