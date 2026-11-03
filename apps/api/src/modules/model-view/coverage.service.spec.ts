import { coverageFrom, judgeCoverage, parseParams, readCoverage } from './coverage.service';

describe('readCoverage', () => {
  it('reads their columns, with Arabic letters too', () => {
    expect(readCoverage([{ 'نام': 'علی', 'نام خانوادگي': 'رضایی', 'کد رايانه': '12', 'معتبر': 'بله' }])).toEqual({
      status: 'VALID', person: { firstName: 'علی', lastName: 'رضایی', insuredCode: '12', birthYear: null }, policy: null,
    });
  });
  it('invalid and missing people', () => {
    expect(readCoverage({ data: [{ 'معتبر': 'خیر' }] }).status).toBe('INVALID');
    expect(readCoverage([]).status).toBe('NOT_FOUND');
  });
  it('an unexpected reply is an error, not a verdict', () => {
    expect(() => readCoverage({ foo: 1 })).toThrow();
  });
  it('follows the columns, rows path and valid values Super Admin set', () => {
    const cfg = coverageFrom({ rowsPath: 'result.items', validValues: 'Y', fields: { valid: 'isValid', firstName: 'fname', lastName: 'lname', nationalCode: 'nid', policyNumber: 'policyNo', policyStart: 'from', policyEnd: 'to' } });
    const body = { result: { items: [
      { nid: '1111111111', fname: 'همسر', isValid: 'N' },
      { nid: '0012345678', fname: 'علی', lname: 'رضایی', isValid: 'Y', policyNo: '626', from: '1405/05/01', to: '1406/05/01' },
    ] } };
    const r = readCoverage(body, cfg, '0012345678');
    expect(r.status).toBe('VALID');
    expect(r.person?.firstName).toBe('علی'); // this person's own row, not the first one
    expect(r.policy?.number).toBe('626');
    expect(r.policy?.start?.slice(0, 10)).toBe('2026-07-22'); // ۱۴۰۵/۰۵/۰۱
  });
});

describe('judgeCoverage', () => {
  const cfg = coverageFrom({});
  const covered = { status: 'VALID' as const, person: null, policy: { number: '626', start: '2026-07-22T00:00:00.000Z', end: '2027-07-22T00:00:00.000Z' } };
  it('an event outside the policy period is not covered', () => {
    expect(judgeCoverage(covered, cfg, new Date('2028-01-01')).status).toBe('INVALID');
    expect(judgeCoverage(covered, cfg, new Date('2028-01-01')).reason).toBe('OUT_OF_PERIOD');
  });
  it('inside the period, without dates, or with the check off: unchanged', () => {
    expect(judgeCoverage(covered, cfg, new Date('2027-01-01')).status).toBe('VALID');
    expect(judgeCoverage(covered, cfg, null).status).toBe('VALID');
    expect(judgeCoverage(covered, coverageFrom({ checkPeriod: false }), new Date('2028-01-01')).status).toBe('VALID');
  });
});

describe('parseParams', () => {
  it('reads «name=value» lines', () => {
    expect(parseParams('insurer=alborz\n\n bad line \ntoken = a=b ')).toEqual([['insurer', 'alborz'], ['token', 'a=b']]);
  });
});
