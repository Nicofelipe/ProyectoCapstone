import { CommonModule } from '@angular/common';
import { Component, ElementRef, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { IonicModule, SegmentCustomEvent } from '@ionic/angular'; // 👈 importa SegmentCustomEvent
import { CAMBIOTECAS } from 'src/app/pages/cambiotecas/data';
import { geocodeAll, loadCsv, loadMetroCsv, Placemark } from 'src/app/utils/geo-loaders';
import { environment } from 'src/environments/environment';

type LatLng = google.maps.LatLngLiteral;
type LayerKey = 'cambiotecas' | 'duoc' | 'bibliotecas' | 'metro';

interface Pin { name: string; address?: string; position: LatLng; }

@Component({
  selector: 'app-map-cambiotecas-embed',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './map-cambiotecas-embed.component.html',
  styleUrls: ['./map-cambiotecas-embed.component.scss'],
})
export class MapCambiotecasEmbedComponent implements OnInit, OnDestroy {
  @Input() height = 420;
  @ViewChild('mapEl', { static: true }) mapEl!: ElementRef<HTMLDivElement>;

  activeLayer: LayerKey = 'cambiotecas';
  pinCount = 0;

  private map!: google.maps.Map;
  private info!: google.maps.InfoWindow;
  private markers: google.maps.Marker[] = [];
  private layerCache: Record<LayerKey, Pin[] | undefined> = { cambiotecas: undefined, duoc: undefined, bibliotecas: undefined, metro: undefined };

  private readonly CSV = {
    duoc: 'assets/data/duoc_sedes_rm.csv',
    bibliotecas: 'assets/data/bibliotecas_santiago.csv',
    metro: 'assets/data/Estaciones_actuales_Metro_de_Santiago.csv',
  } as const;

  async ngOnInit() {
    setOptions({ key: environment.googleMaps.apiKey, v: 'weekly' });
    const { Map } = await importLibrary('maps') as google.maps.MapsLibrary;
    await importLibrary('marker');

    this.map = new Map(this.mapEl.nativeElement, {
      center: environment.googleMaps?.defaultCenter ?? { lat: -33.45, lng: -70.65 },
      zoom: environment.googleMaps?.defaultZoom ?? 12,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    this.info = new google.maps.InfoWindow();

    await this.switchLayer(this.activeLayer);
  }

  ngOnDestroy() { this.clearMarkers(); }

  // ✅ Tipado correcto + fallback
  async onSegmentChange(ev: SegmentCustomEvent) {
    const value = (ev.detail?.value ?? 'cambiotecas') as LayerKey;
    if (value === this.activeLayer) return;
    await this.switchLayer(value);
  }

  private async switchLayer(layer: LayerKey) {
    this.activeLayer = layer;
    this.clearMarkers();

    const pins = await this.getPinsFor(layer);
    this.addPins(pins);
    this.fitToMarkers();
    this.pinCount = pins.length;
  }

  private async getPinsFor(layer: LayerKey): Promise<Pin[]> {
    if (this.layerCache[layer]) return this.layerCache[layer]!;
    let pins: Pin[] = [];

    if (layer === 'cambiotecas') {
      const envPins: Pin[] = (environment as any).cambiotecas?.map((p: any) => ({
        name: p.name, address: p.address, position: p.position as LatLng
      })) ?? [];
      const staticPins: Pin[] = CAMBIOTECAS.map(p => ({ name: p.nombre, address: p.direccion, position: p.position }));
      pins = [...envPins, ...staticPins];
    } else if (layer === 'metro') {
      const geos = await loadMetroCsv(this.CSV.metro);
      pins = geos.map(g => ({ name: g.name, address: g.address, position: { lat: g.lat, lng: g.lng } }));
    } else {
      const rows: Placemark[] = await loadCsv(this.CSV[layer]);
      const geos = await geocodeAll(rows);
      pins = geos.map(g => ({ name: g.name, address: g.address, position: { lat: g.lat, lng: g.lng } }));
    }

    this.layerCache[layer] = pins;
    return pins;
  }

  private addPins(pins: Pin[]) {
    for (const p of pins) {
      const marker = new google.maps.Marker({
        position: p.position,
        map: this.map,
        title: p.name,
        icon: this.iconFor(this.activeLayer),
      });
      marker.addListener('click', () => {
        const dest = `${p.position.lat},${p.position.lng}`;
        const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
        this.info.setContent(`
          <div class="info">
            <div class="ttl">${p.name}</div>
            ${p.address ? `<div class="addr">${p.address}</div>` : ''}
            <a href="${url}" target="_blank" rel="noopener">Cómo llegar</a>
          </div>
        `);
        this.info.open(this.map, marker);
      });
      this.markers.push(marker);
    }
  }

  private clearMarkers() {
    this.markers.forEach(m => m.setMap(null));
    this.markers = [];
  }

  private fitToMarkers() {
    if (!this.markers.length) return;
    const b = new google.maps.LatLngBounds();
    this.markers.forEach(m => b.extend(m.getPosition()!));
    this.map.fitBounds(b);
    google.maps.event.addListenerOnce(this.map, 'idle', () => {
      if ((this.map.getZoom() ?? 12) > 16) this.map.setZoom(16);
    });
  }

  private iconFor(layer: LayerKey): google.maps.Icon {
    const base = 'https://maps.gstatic.com/mapfiles/ms2/micons/';
    const file =
      layer === 'cambiotecas' ? 'purple-dot.png' :
      layer === 'duoc'         ? 'blue-dot.png'   :
      layer === 'bibliotecas'  ? 'green-dot.png'  :
                                 'red-dot.png';
    return { url: base + file };
  }
}
