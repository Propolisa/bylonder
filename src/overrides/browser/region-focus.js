// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Chromium's pointer events: a region takes the keyboard when the pointer enters it, but not from a field being edited inside it, as Chromium sends the region another pointerenter when a number field turns into its text field under the pointer; goes when Chromium sends none.

export const focusUnlessInside = (event) => {
  const region = event.currentTarget;
  if (!region.contains(region.ownerDocument.activeElement)) region.focus({ preventScroll: true });
};
