// src/app/pages/books/title-results/title-results.page.ts
import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonAvatar, IonBadge,
  IonButtons, IonContent, IonHeader,
  IonItem, IonLabel, IonList,
  IonMenuButton, IonTitle, IonToolbar
} from '@ionic/angular/standalone';
import { environment } from 'src/environments/environment';
import { BookByTitleItem, BooksService } from '../../../core/services/books.service';

// 👇 nuevos servicios
import { AuthService, MeUser } from 'src/app/core/services/auth.service';
import { IntercambiosService } from 'src/app/core/services/intercambios.service';

@Component({
  selector: 'app-title-results',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton, IonList, IonItem, IonLabel, IonAvatar, IonBadge
  ],
  templateUrl: './title-results.page.html',
  styleUrls: ['./title-results.page.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class TitleResultsPage implements OnInit {
  title = '';
  loading = false;
  items: BookByTitleItem[] = [];

  me: MeUser | null = null;
  /** IDs de libros para los que YA envié una solicitud PENDIENTE */
  pendingFor = new Set<number>();

  /** base absoluta para /media del backend */
  private readonly mediaBase =
    (environment as any).mediaBase ??
    ((environment as any).apiUrl
      ? `${(environment as any).apiUrl.replace(/\/+$/, '')}/media/`
      : '/media/');

  /** portada por defecto (absoluta) */
  readonly defaultCover = `${this.mediaBase}books/librodefecto.png`;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private books: BooksService,
    private auth: AuthService,
    private interSvc: IntercambiosService,
  ) { }

  async ngOnInit() {
    this.title = decodeURIComponent(this.route.snapshot.paramMap.get('title') || '');

    // sesión y solicitudes pendientes del usuario (si está logueado)
    await this.auth.restoreSession();
    this.me = this.auth.user;

    this.fetch();
    if (this.me) this.loadPending();
  }

  go(id: number) {
    this.router.navigate(['/books/view', id]);
  }

  /** Decide la URL a mostrar (first_image ya viene absoluta; si no, fallback absoluto) */
  cover(b: BookByTitleItem): string {
    if (b.first_image && /^https?:\/\//i.test(b.first_image)) return b.first_image;
    return this.defaultCover;
  }

  onImgError(ev: Event) {
    const img = ev.target as HTMLImageElement;
    if (img && img.src !== this.defaultCover) img.src = this.defaultCover;
  }

  fetch() {
    this.loading = true;
    this.books.listByTitle(this.title).subscribe({
      next: (arr) => { this.items = arr || []; this.loading = false; },
      error: () => { this.items = []; this.loading = false; }
    });
  }

  pendingByDesiredBookId = new Set<number>();
  /** Carga las solicitudes ENVIADAS por mí y marca las PENDIENTES por id_libro_deseado */
  private loadPending() {
    this.interSvc.listarEnviadas(this.me!.id).subscribe({
      next: (rows: unknown) => {
        const arr = Array.isArray(rows) ? rows : [];
        const ids = new Set<number>();

        for (const s of arr as any[]) {
          const estado = String(s?.estado_slug ?? s?.estado ?? '').toLowerCase();
          if (estado === 'pendiente') {
            const lid = Number(
              s?.libro_deseado?.id_libro ??
              s?.libro_deseado?.id ??
              s?.libro_deseado_id ??
              NaN
            );
            if (!Number.isNaN(lid)) ids.add(lid);
          }
        }

        this.pendingFor = ids;
      },
      error: () => {
        this.pendingFor = new Set<number>();
      },
    });
  }
}