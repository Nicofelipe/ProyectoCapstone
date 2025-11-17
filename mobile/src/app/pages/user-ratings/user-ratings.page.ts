// src/app/pages/user-ratings/user-ratings.page.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import ApiService from 'src/app/core/services/api.service';

// 👇 Interfaz alineada con lo que devuelve user_ratings_view
interface UserRating {
  id: number;
  intercambio_id: number | null;
  tipo: 'recibida' | 'enviada' | string;
  estrellas: number | string;
  comentario: string;
  fecha: string | null;
  libro_titulo: string;
  contraparte_nombre: string;
}

@Component({
  selector: 'app-user-ratings',
  standalone: true,
  templateUrl: './user-ratings.page.html',
  styleUrls: ['./user-ratings.page.scss'],
  imports: [IonicModule, CommonModule],
})
export class UserRatingsPage implements OnInit {

  // Para usar Math en el template
  readonly Math = Math;

  userId!: number;
  userName?: string | null;

  ratings: UserRating[] = [];
  loading = true;
  error?: string;

  promedio: number | null = null;
  total = 0;

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
  ) {}

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    this.userId = idParam ? Number(idParam) : NaN;
    this.userName = this.route.snapshot.queryParamMap.get('name');

    if (!this.userId || isNaN(this.userId)) {
      this.error = 'ID de usuario inválido.';
      this.loading = false;
      return;
    }

    this.loadRatings();
  }

  // 👇 Puntaje numérico usando el campo "estrellas" del backend
  scoreOf(r: UserRating): number {
    const n = Number(r.estrellas ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  async loadRatings(): Promise<void> {
    this.loading = true;
    this.error = undefined;

    try {
      const data = await firstValueFrom(
        this.api.get<UserRating[]>(`/api/users/${this.userId}/ratings/`)
      );

      // Solo las calificaciones que EL USUARIO RECIBE (igual que metrics.calificacion)
      const recibidas = data.filter(r => r.tipo === 'recibida');

      this.ratings = recibidas;
      this.total = recibidas.length;

      if (this.total > 0) {
        const sum = recibidas.reduce(
          (acc, r) => acc + this.scoreOf(r),
          0
        );
        this.promedio = sum / this.total;
        console.log('Ratings recibidas:', recibidas, 'sum:', sum, 'promedio:', this.promedio);
      } else {
        this.promedio = 0;
      }
    } catch (err) {
      console.error(err);
      this.error = 'No se pudieron cargar las calificaciones.';
      this.promedio = null;
      this.ratings = [];
      this.total = 0;
    } finally {
      this.loading = false;
    }
  }

  // Para dibujar estrellas
  starsArray(size: number = 5): number[] {
    return Array.from({ length: size }, (_, i) => i + 1);
  }
}
