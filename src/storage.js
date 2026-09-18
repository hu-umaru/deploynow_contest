import { validateProject } from './project.js';
let database;
function open() {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open('quantum-beat-studio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => { database = null; throw error; });
  return database;
}
export async function saveProject(project) {
  const data = validateProject(project), db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').put(data, 'last');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function loadProject() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('projects').objectStore('projects').get('last');
    request.onsuccess = () => { try { resolve(request.result ? validateProject(request.result) : null); } catch (error) { reject(error); } };
    request.onerror = () => reject(request.error);
  });
}
