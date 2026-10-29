// Asks for operator properties in Blender's props dialog: resolves to the values entered, or null when cancelled.
//   fields: [{ name, label, value }]; at: the pointer, in client pixels.
export async function propsDialog({ title, fields, confirm, at = { x: innerWidth / 2, y: innerHeight / 2 } }) {
  const [{ createApp, h }, { default: PropsDialog }] = await Promise.all([
    import('vue'),
    import('./components/PropsDialog.vue'),
    import('./components/tailwind.css'),
  ]);
  const host = document.body.appendChild(document.createElement('div'));
  return new Promise((resolve) => {
    const app = createApp({ render: () => h(PropsDialog, { title, fields, confirm, at, onDone: (values) => { app.unmount(); host.remove(); resolve(values); } }) });
    app.mount(host);
  });
}

// One text property: its value, or null.
export const askText = async (title, label, value, at) => (await propsDialog({ title, fields: [{ name: 'value', label, value }], at }))?.value ?? null;
