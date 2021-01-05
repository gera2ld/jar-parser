export function getDep(context, { name, fullName, t, e }) {
  const dep = {
    name,
    fullName,
    t: t || [],
    e,
  };
  if (!name) throw new Error('name is required');
  context.deps.items.push(dep);
  return dep;
}

export function initContext(file) {
  return {
    filename: file.name,
    deps: {
      exact: {},
      wild: [],
      items: [],
    },
  };
}
