// src/app/pages/cambiotecas/data.ts
export interface CambiotecaPoint {
  id: number;
  nombre: string;
  direccion?: string;
  position: google.maps.LatLngLiteral;
}

export const CAMBIOTECAS: CambiotecaPoint[] = [
  

];
