// Плоская 2D-матрица (a b c d e f), повторяет DOMMatrix, но обычным объектом:
// так мировые преобразования считаются без DOM и проверяются тестами.

export interface Mat {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function mul(m: Mat, n: Mat): Mat {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f
  };
}

export function translate(m: Mat, x: number, y: number): Mat {
  return mul(m, { a: 1, b: 0, c: 0, d: 1, e: x, f: y });
}

export function rotate(m: Mat, deg: number): Mat {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return mul(m, { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 });
}

export function scale(m: Mat, sx: number, sy: number): Mat {
  return mul(m, { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
}

export function invert(m: Mat): Mat {
  const det = m.a * m.d - m.b * m.c || 1;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det
  };
}

export function applyPoint(m: Mat, x: number, y: number): [number, number] {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}
