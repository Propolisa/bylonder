// Shims for intern/eigen (eigen_capi.h): Blender's C API over Eigen.
// port-override: Blender solves with Eigen's SparseLU; the systems ported code builds are small, so this solves the
// same equations densely by Gaussian elimination with partial pivoting, in double precision as Eigen does.

// A solver for num_rows equations in num_columns unknowns, with num_rhs right-hand sides; least squares solves the
// normal equations M^T M x = M^T b.
function solver_new(num_rows, num_columns, num_rhs, least_squares) {
  return {
    least_squares, rows: num_rows, columns: num_columns,
    m: Array.from({ length: num_rows }, () => new Float64Array(num_columns)),
    b: Array.from({ length: num_rhs }, () => new Float64Array(num_rows)),
    x: Array.from({ length: num_rhs }, () => new Float64Array(num_columns)),
  };
}

export const EIG_linear_solver_new = (num_rows, num_columns, num_rhs) => solver_new(num_rows, num_columns, num_rhs, false);
export const EIG_linear_least_squares_solver_new = (num_rows, num_columns, num_rhs) => solver_new(num_rows, num_columns, num_rhs, true);
// The garbage collector frees the solver.
export function EIG_linear_solver_delete(_solver) {}

export function EIG_linear_solver_matrix_add(solver, row, col, value) {
  solver.m[row][col] += value;
}

export function EIG_linear_solver_right_hand_side_add(solver, rhs, index, value) {
  solver.b[rhs][index] += value;
}

export const EIG_linear_solver_variable_get = (solver, rhs, index) => solver.x[rhs][index];
export function EIG_linear_solver_variable_set(solver, rhs, index, value) {
  solver.x[rhs][index] = value;
}

// Solves A x = y for square A (rows of Float64Array), or returns false when A is singular.
function gauss(a, y) {
  const n = a.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (a[p][c] === 0) return false;
    [a[c], a[p]] = [a[p], a[c]];
    [y[c], y[p]] = [y[p], y[c]];
    for (let r = c + 1; r < n; r++) {
      const f = a[r][c] / a[c][c];
      if (f === 0) continue;
      for (let k = c; k < n; k++) a[r][k] -= f * a[c][k];
      y[r] -= f * y[c];
    }
  }
  for (let c = n - 1; c >= 0; c--) {
    let s = y[c];
    for (let k = c + 1; k < n; k++) s -= a[c][k] * y[k];
    y[c] = s / a[c][c];
  }
  return true;
}

export function EIG_linear_solver_solve(solver) {
  const { m, rows, columns } = solver;
  for (let rhs = 0; rhs < solver.b.length; rhs++) {
    let a, y;
    if (solver.least_squares) {
      a = Array.from({ length: columns }, (_, i) => Float64Array.from({ length: columns }, (_, j) => {
        let s = 0;
        for (let r = 0; r < rows; r++) s += m[r][i] * m[r][j];
        return s;
      }));
      y = Float64Array.from({ length: columns }, (_, i) => {
        let s = 0;
        for (let r = 0; r < rows; r++) s += m[r][i] * solver.b[rhs][r];
        return s;
      });
    } else {
      a = m.map((row) => Float64Array.from(row));
      y = Float64Array.from(solver.b[rhs]);
    }
    if (!gauss(a, y)) return false;
    solver.x[rhs].set(y);
  }
  return true;
}

export function EIG_linear_solver_print_matrix(_solver) {}
