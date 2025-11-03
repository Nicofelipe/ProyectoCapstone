import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { IonicModule } from '@ionic/angular';
import { geocodeAll, loadCsv, loadMetroCsv, Placemark } from 'src/app/utils/geo-loaders';
import { environment } from 'src/environments/environment';
import { CAMBIOTECAS } from './data';



type LatLng = google.maps.LatLngLiteral;
type LayerKey = 'cambiotecas' | 'duoc' | 'bibliotecas' | 'metro';

interface Pin { name: string; position: LatLng; address?: string; }

@Component({
  selector: 'app-map-cambiotecas',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './map-cambiotecas.page.html',
  styleUrls: ['./map-cambiotecas.page.scss'],
})
export class MapCambiotecasPage implements OnInit, OnDestroy {
  @ViewChild('mapEl', { static: true }) mapEl!: ElementRef<HTMLDivElement>;

  private map!: google.maps.Map;
  private info!: google.maps.InfoWindow;
  private markers: google.maps.Marker[] = [];

  activeLayer: LayerKey = 'cambiotecas';
  pinCount = 0;

  // Rutas a tus CSV en assets (asegúrate que tengan header: name,address,comuna)
  private readonly CSV = {
    duoc: 'assets/data/duoc_sedes_rm.csv',
    bibliotecas: 'assets/data/bibliotecas_santiago.csv',
    metro: 'assets/data/Estaciones_actuales_Metro_de_Santiago.csv',
  } as const;

  // cache en memoria + localStorage para resultados geocodificados
  private layerCache: Record<string, Pin[] | undefined> = {};

  async ngOnInit() {
    await this.initMap();
    await this.switchLayer(this.activeLayer);
  }

  ngOnDestroy() {
    this.clearMarkers();
  }

  // =============== MAPA ============
  private async initMap() {
    setOptions({ key: environment.googleMaps.apiKey, v: 'weekly' });
    const { Map } = await importLibrary('maps') as google.maps.MapsLibrary;
    await importLibrary('marker');

    this.map = new Map(this.mapEl.nativeElement, {
      center: environment.googleMaps.defaultCenter,
      zoom: environment.googleMaps.defaultZoom,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });

    this.info = new google.maps.InfoWindow();
  }

  // =============== CAPAS ============
  async onLayerChange(ev: CustomEvent) {
    await this.switchLayer((ev.detail?.value || 'cambiotecas') as LayerKey);
  }

  private async switchLayer(layer: LayerKey) {
    this.activeLayer = layer;
    this.clearMarkers();

    const pins = await this.getLayerPins(layer);
    this.addPins(pins);
    this.fitMarkers();
    this.pinCount = pins.length;
  }

  private async getLayerPins(layer: LayerKey): Promise<Pin[]> {
    if (this.layerCache[layer]) return this.layerCache[layer]!;

    const lsKey = `geo-cache:${layer}:v1`;
    const cached = localStorage.getItem(lsKey);
    if (cached) {
      const pins = JSON.parse(cached) as Pin[];
      this.layerCache[layer] = pins;
      return pins;
    }

    let pins: Pin[] = [];
    if (layer === 'cambiotecas') {
      const fromEnv = (environment.cambiotecas || []).map((p: any) => ({
        name: p.name, address: p.address, position: p.position as LatLng,
      }));
      const fromTs = CAMBIOTECAS.map(p => ({ name: p.nombre, address: p.direccion, position: p.position }));
      pins = [...fromEnv, ...fromTs];

    } else if (layer === 'metro') {
      const geos = await loadMetroCsv(this.CSV.metro);
      pins = geos.map(g => ({ name: g.name, address: g.address, position: { lat: g.lat, lng: g.lng } }));

    } else {
      // duoc / bibliotecas -> CSV + geocoder
      const path = this.CSV[layer];
      const rows: Placemark[] = await loadCsv(path);
      const geos = await geocodeAll(rows);
      pins = geos.map(g => ({ name: g.name, address: g.address, position: { lat: g.lat, lng: g.lng } }));
    }

    this.layerCache[layer] = pins;
    localStorage.setItem(lsKey, JSON.stringify(pins));
    return pins;
  }
  // =============== MARCADORES ============
  private addPins(pins: Pin[]) {
    for (const p of pins) {
      const marker = new google.maps.Marker({
        position: p.position,
        map: this.map,
        title: p.name,
        // icono sutil según capa
        icon: this.iconForLayer(this.activeLayer),
      });
      marker.addListener('click', () => {
        const dest = `${p.position.lat},${p.position.lng}`;
        const gmUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
        this.info.setContent(
          `<div class="info">
            <div class="ttl">${p.name}</div>
            ${p.address ? `<div class="addr">${p.address}</div>` : ''}
            <a href="${gmUrl}" target="_blank" rel="noopener">Cómo llegar</a>
          </div>`
        );
        this.info.open(this.map, marker);
      });
      this.markers.push(marker);
    }
  }

  private iconForLayer(layer: LayerKey): google.maps.Icon | undefined {
    const base = 'https://maps.gstatic.com/mapfiles/ms2/micons/';
    const file =
      layer === 'cambiotecas' ? 'purple-dot.png' :
        layer === 'duoc' ? 'blue-dot.png' :
          layer === 'bibliotecas' ? 'green-dot.png' :
            'red-dot.png';   // metro
    return { url: base + file };
  }

  private clearMarkers() {
    this.markers.forEach(m => m.setMap(null));
    this.markers = [];
  }

  private fitMarkers() {
    if (!this.markers.length) return;
    const bounds = new google.maps.LatLngBounds();
    this.markers.forEach(m => bounds.extend(m.getPosition()!));
    this.map.fitBounds(bounds);
    google.maps.event.addListenerOnce(this.map, 'idle', () => {
      if ((this.map.getZoom() ?? 12) > 16) this.map.setZoom(16);
    });
  }
}
