// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's node editor: shown with the page's alert silenced, as its Show() raises a browser alert Bylonder's editor has no use for; goes when Babylon's editor shows without one.

export async function show(Editor, options) {
  const alert = window.alert;
  window.alert = () => {};
  try { Editor.Show(options); } finally { window.alert = alert; }
}
