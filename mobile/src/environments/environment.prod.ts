export const environment = {
  production: true,
  apiUrl: 'https://proyectocapstone-production.up.railway.app', // backend base
  mediaBase: 'https://proyectocapstone-production.up.railway.app/media/',
  googleMaps: {
    // sin apiKey aquí
    defaultCenter: { lat: -33.4489, lng: -70.6693 },
    defaultZoom: 12,
  },
  cambiotecas: [
    { id: 1, name: 'Cambioteca La Farfana', address: 'Diez Puma 95, Maipú, RM', position: { lat: -33.491339413179055, lng: -70.77278467519258 } },
    { id: 2, name: 'Cambioteca El Abrazo', address: 'Pioneros Evangelistas 3031, Maipú, RM', position: { lat: -33.52873470047291, lng: -70.7943495751906 } },
  ],
};
/*

export const environment = {
  production: false,
  apiUrl: 'http://127.0.0.1:8000/',
  mediaBase: 'http://127.0.0.1:8000/media/',
  googleMaps: {
    apiKey: 'AIzaSyC7x_K8ReP0aFxJ54GrHxNXPfk0laL-HuE',
    defaultCenter: { lat: -33.4489, lng: -70.6693 }, // Santiago (ajusta)
    defaultZoom: 12
  },
  
  // Opcional: puntos fijos
  cambiotecas: [
    {
      id: 1,
      name: 'Cambioteca La Farfana',
      address: 'Diez Puma 95, Maipú, RM',
      position: { lat: -33.491339413179055, lng: -70.77278467519258 }
    },
    {
      id: 2,
      name: 'Cambioteca El Abrazo',
      address: 'Pioneros Evangelistas 3031, Maipú, RM',
      position: { lat: -33.52873470047291, lng: -70.7943495751906 }
    },
  ],
};*/