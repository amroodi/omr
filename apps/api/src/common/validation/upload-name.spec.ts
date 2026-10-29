import { uploadName } from './upload-name';

/** What busboy hands over for a UTF-8 file name: its bytes read as Latin-1. */
const asReceived = (real: string) => Buffer.from(real, 'utf8').toString('latin1');

describe('uploadName', () => {
  it('restores Persian names', () => {
    const real = 'فرم ثبت حادثه آتش سوزی-مهرگفتار.docx';
    expect(asReceived(real)).not.toBe(real);
    expect(uploadName(asReceived(real))).toBe(real);
  });

  it('leaves plain ASCII, real Unicode and genuine Latin-1 names alone', () => {
    expect(uploadName('scan-01.pdf')).toBe('scan-01.pdf');
    expect(uploadName('گواهی فوت.pdf')).toBe('گواهی فوت.pdf');
    expect(uploadName('café.pdf')).toBe('café.pdf');
  });

  it('is idempotent (the repair script may run on every deploy)', () => {
    const once = uploadName(asReceived('مدارک.pdf'));
    expect(uploadName(once)).toBe(once);
  });

  it('handles empty input', () => {
    expect(uploadName(undefined)).toBe('');
  });
});
