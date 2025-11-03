import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { environment } from 'src/environments/environment';


import { MapCambiotecasEmbedComponent } from 'src/app/components/map-cambiotecas-embed/map-cambiotecas-embed.component';

type LatLng = { lat: number; lng: number };

interface Punto {
  id: number;
  name?: string;
  nombre?: string;
  address?: string;
  direccion?: string;
  position: LatLng;
}

@Component({
  selector: 'app-about-us',
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, MapCambiotecasEmbedComponent],
  templateUrl: './about-us.page.html',
  styleUrls: ['./about-us.page.scss'],
})
export class AboutUsPage implements OnInit {
  mapHeight = 420;

  puntos: Punto[] = (environment as any).cambiotecas ?? [
    {
      id: 1,
      name: 'Cambioteca La Farfana',
      address: 'Diez Puma 95, Maipú, RM',
      position: { lat: -33.491339413179055, lng: -70.77278467519258 },
    },
    {
      id: 2,
      name: 'Cambioteca El Abrazo',
      address: 'Pioneros Evangelistas 3031, Maipú, RM',
      position: { lat: -33.52873470047291, lng: -70.7943495751906 },
    },
  ];

  ngOnInit() {
    // Ajusta alto del mapa de forma responsiva
    const h = Math.round(window.innerHeight * 0.55);
    this.mapHeight = Math.min(560, Math.max(380, h));
  }

  gmUrl(p: Punto) {
    const dest = `${p.position.lat},${p.position.lng}`;
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
  }
}
