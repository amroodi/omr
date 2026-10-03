declare module 'jalaali-js' {
  export function toJalaali(gy: number | Date, gm?: number, gd?: number): { jy: number; jm: number; jd: number };
  export function toGregorian(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number };
  export function isValidJalaaliDate(jy: number, jm: number, jd: number): boolean;
}
