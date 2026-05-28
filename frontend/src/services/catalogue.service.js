import api from '../utils/api';

export async function getCatalogue() {
  const res = await api.get('/catalogue');
  return res.data;
}

export async function createCatalogueItem(data) {
  const res = await api.post('/catalogue', data);
  return res.data;
}

export async function updateCatalogueItem(id, data) {
  const res = await api.put(`/catalogue/${id}`, data);
  return res.data;
}

export async function deleteCatalogueItem(id) {
  const res = await api.delete(`/catalogue/${id}`);
  return res.data;
}
