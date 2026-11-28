import type { LmbpCatalogModel, ProviderModelInfo, ProviderType } from './contracts';

type DisplayIds = Readonly<Record<string, string>>;

export function getModelDisplayId(
  id: string,
  provider: ProviderType | '' | undefined,
  known: DisplayIds
): string {
  if (provider && provider !== 'lmbp') return id;
  if (Object.hasOwn(known, id)) return known[id];
  // Historical sessions may only have a route, before their first catalog refresh.
  return provider === 'lmbp' || /^dev_[0-9a-f]{32}\//.test(id) ? '' : id;
}

function getDeviceLabel(device: LmbpCatalogModel['device'], devices: Map<string, string>): string {
  if (!device.name) return device.id;
  const sameName = [...devices.keys()].filter((id) => devices.get(id) === device.name);
  if (sameName.length === 1) return device.name;
  return `${device.name} (${sameName.sort().indexOf(device.id) + 1})`;
}

/** Use scheme names in the picker, qualifying a label only when another entry shares it. */
export function getLmbpModelOptions(models: LmbpCatalogModel[]): ProviderModelInfo[] {
  const groups = new Map<string, { models: Set<string>; devices: Map<string, string> }>();
  const labels = models.map((model) => {
    const name = model.scheme?.name || model.displayName || model.modelId;
    const group = groups.get(name) ?? {
      models: new Set<string>(),
      devices: new Map<string, string>(),
    };
    group.models.add(model.modelId);
    group.devices.set(model.device.id, model.device.name);
    groups.set(name, group);
    return name;
  });
  return models.map((model, index) => {
    const label = labels[index];
    const group = groups.get(label)!;
    const parts = [label];
    if (group.models.size > 1 && model.modelId !== label) parts.push(model.modelId);
    if (group.devices.size > 1) parts.push(getDeviceLabel(model.device, group.devices));
    return {
      id: model.routeId,
      name: parts.join(' · '),
      upstreamModel: model.modelId,
      capabilities: model.capabilities,
    };
  });
}
