const BRANDS = {
  sophron: {
    id: 'sophron',
    productName: 'sophron cowork',
    artifactName: 'sophron',
    locale: 'en',
    copyrightOwner: 'sophron',
  },
  'sophron-cn': {
    id: 'sophron-cn',
    productName: '九思助理',
    artifactName: 'sophron-cn',
    locale: 'zh',
    copyrightOwner: '九思助理',
  },
};

function normalizeBrandId(value) {
  const id = String(value || 'sophron').trim().toLowerCase();
  if (id === 'cn' || id === 'zh' || id === 'zh-cn') return 'sophron-cn';
  if (id === 'en' || id === 'english') return 'sophron';
  return id;
}

function getBrand(value = process.env.SOPHRON_BUILD_VARIANT) {
  const id = normalizeBrandId(value);
  const brand = BRANDS[id];
  if (!brand) {
    throw new Error(`Unknown sophron build variant "${value}". Use: sophron, sophron-cn, all.`);
  }
  return brand;
}

function getBrandList(value = process.env.SOPHRON_BUILD_VARIANT) {
  const id = normalizeBrandId(value || 'all');
  if (id === 'all') return [BRANDS.sophron, BRANDS['sophron-cn']];
  return [getBrand(id)];
}

module.exports = {
  BRANDS,
  getBrand,
  getBrandList,
  normalizeBrandId,
};
