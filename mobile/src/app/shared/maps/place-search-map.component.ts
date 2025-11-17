import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnInit, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { IonicModule, IonSearchbar } from '@ionic/angular';
import { ConfigService } from 'src/app/core/services/config.service';
import { environment } from 'src/environments/environment';

type LatLng = google.maps.LatLngLiteral;

export interface PlacePicked {
  name?: string | null;
  address: string;
  position: LatLng;
}

@Component({
  selector: 'app-place-search-map',
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  templateUrl: './place-search-map.component.html',
  styleUrls: ['./place-search-map.component.scss']
})
export class PlaceSearchMapComponent implements OnInit {
  @Output() picked = new EventEmitter<PlacePicked>();

  @ViewChild(IonSearchbar, { static: true }) searchbar!: IonSearchbar;
  private map!: google.maps.Map;
  private marker!: google.maps.Marker;

  ready = false;
  selected: PlacePicked | null = null;

  height = 320;

  constructor(private cfg: ConfigService) {}

  async ngOnInit() {
    await this.cfg.load();
    setOptions({ key: this.cfg.config.mapsApiKey, v: 'weekly' });

    const { Map } = await importLibrary('maps') as google.maps.MapsLibrary;
    await importLibrary('marker');
    const placesLib = await importLibrary('places');

    // mapa base
    const center = environment.googleMaps?.defaultCenter ?? { lat: -33.45, lng: -70.65 };
    const mapEl = document.getElementById('place-search-map') as HTMLDivElement;
    this.map = new Map(mapEl, {
      center,
      zoom: environment.googleMaps?.defaultZoom ?? 13,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });

    // marker arrastrable
    this.marker = new google.maps.Marker({
      position: center,
      map: this.map,
      draggable: true,
    });
    this.marker.addListener('dragend', () => {
      const pos = this.marker.getPosition();
      if (!pos) return;
      const position = { lat: pos.lat(), lng: pos.lng() };
      this.selected = {
        name: this.selected?.name ?? null,
        address: this.selected?.address ?? `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`,
        position
      };
    });

    // Autocomplete sobre IonSearchbar
    const input = await this.searchbar.getInputElement();
    const ac = new (placesLib as any).Autocomplete(input, {
      fields: ['formatted_address', 'name', 'geometry'],
      componentRestrictions: { country: ['cl'] }
    });
    ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      const loc = place?.geometry?.location;
      if (!loc) return;
      const position = { lat: loc.lat(), lng: loc.lng() };
      this.map.setCenter(position);
      this.map.setZoom(16);
      this.marker.setPosition(position);
      this.selected = {
        name: place?.name ?? null,
        address: place?.formatted_address ?? `${position.lat}, ${position.lng}`,
        position
      };
    });

    this.ready = true;
  }

  async useMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => {
      const position = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      this.map.setCenter(position);
      this.map.setZoom(16);
      this.marker.setPosition(position);
      this.selected = {
        name: 'Mi ubicación',
        address: `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`,
        position
      };
      this.searchbar.value = '';
    });
  }

  confirmPick() {
    if (this.selected) this.picked.emit(this.selected);
  }
}
