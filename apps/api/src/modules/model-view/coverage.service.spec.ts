import { readCoverage } from './coverage.service';

describe('readCoverage', () => {
  it('reads their columns, with Arabic letters too', () => {
    expect(readCoverage([{ 'نام': 'علی', 'نام خانوادگي': 'رضایی', 'کد رايانه': '12', 'معتبر': 'بله' }])).toEqual({ status: 'VALID', person: { firstName: 'علی', lastName: 'رضایی', insuredCode: '12' } });
  });
  it('invalid and missing people', () => {
    expect(readCoverage({ data: [{ 'معتبر': 'خیر' }] }).status).toBe('INVALID');
    expect(readCoverage([]).status).toBe('NOT_FOUND');
  });
  it('an unexpected reply is an error, not a verdict', () => {
    expect(() => readCoverage({ foo: 1 })).toThrow();
  });
});
