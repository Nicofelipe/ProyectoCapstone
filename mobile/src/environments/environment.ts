// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.


export const environment = {
  production: false,
  apiUrl: 'http://127.0.0.1:8000/',  
  mediaBase: 'http://127.0.0.1:8000//media', 
  googleMaps: {
    apiKey: '',
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
};


/*
export const environment = {
  production: false,
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
}

*/

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
