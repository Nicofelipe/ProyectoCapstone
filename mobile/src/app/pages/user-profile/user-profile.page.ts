// src/app/pages/user-profile/user-profile.page.ts
import { CommonModule, Location } from '@angular/common';
import { Component, computed, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule, ToastController } from '@ionic/angular';
import { AuthService } from 'src/app/core/services/auth.service';
import { environment } from 'src/environments/environment';

type PublicProfile = {
  id: number;
  nombre_completo: string;
  email: string;
  rut?: string | null;
  avatar_url: string | null;
  libros_count: number;
  intercambios_count: number;
  rating_avg: number | null;
  rating_count: number;
};

type PublicBook = {
  id: number;
  titulo: string;
  autor: string;
  portada?: string | null;
  fecha_subida?: string | null;
};

type PublicIntercambio = {
  id: number;
  estado: string;
  fecha_intercambio: string | null;
  libro_deseado: { id: number | null; titulo: string | null; portada: string | null };
  libro_ofrecido: { id: number | null; titulo: string | null; portada: string | null };
  conversacion_id?: number | null;
};

@Component({
  standalone: true,
  selector: 'app-user-profile',
  imports: [CommonModule, IonicModule],
  templateUrl: './user-profile.page.html',
  styleUrls: ['./user-profile.page.scss'],
})
export class UserProfilePage implements OnInit {
  loading = signal(true);
  prof = signal<PublicProfile | null>(null);
  books = signal<PublicBook[]>([]);
  history = signal<PublicIntercambio[]>([]);
  tab = signal<'info' | 'books' | 'history'>('info');

  fallbackHref = '/';
  readonly FALLBACK_BOOK = '/assets/librodefecto.png';
  readonly FALLBACK_AVATAR = '/assets/avatardefecto.jpg';

  // ⭐ Normaliza cualquier ruta relativa tipo "media/...", "books/..." a URL absoluta
  private normalizeMedia(rel?: string | null): string | null {
    const raw = (rel || '').trim();
    if (!raw) return null;

    // Si ya es absoluta, la dejamos tal cual
    if (/^https?:\/\//i.test(raw)) return raw;

    // Quitamos / iniciales
    let path = raw.replace(/^\/+/, '');

    // Si viene como "media/xxx", se lo sacamos para no duplicar
    if (path.startsWith('media/')) {
      path = path.substring('media/'.length);
    }

    const base = (environment.mediaBase ||
      `${environment.apiUrl.replace(/\/+$/, '')}/media`
    ).replace(/\/+$/, '');

    return `${base}/${path}`;
  }

  stars = computed(() => {
    const avg = this.prof()?.rating_avg ?? 0;
    const out: string[] = [];
    for (let i = 1; i <= 5; i++) {
      out.push(avg >= i ? 'star' : (avg >= i - 0.5 ? 'star-half' : 'star-outline'));
    }
    return out;
  });

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private auth: AuthService,
    private toast: ToastController,
    private location: Location,
  ) {}

  async ngOnInit() {
    this.fallbackHref = (history.state && history.state.from) || '/';
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!id) {
      this.router.navigateByUrl('/');
      return;
    }

    try {
      const [profile, books, history] = await Promise.all([
        this.auth.getUserProfile(id),
        this.auth.getUserBooks(id),
        this.auth.getUserIntercambios(id),
      ]);

      // 🧑‍🎨 Normalizar avatar (por si viene relativo)
      const avatarNorm = this.normalizeMedia(profile?.avatar_url ?? null);
      this.prof.set({
        ...profile,
        avatar_url: avatarNorm ?? profile?.avatar_url ?? null,
      });

      // 📚 Normalizar portadas de libros (tome lo que venga: portada, first_image, cover...)
      const normalizedBooks: PublicBook[] = (books || []).map((b: any) => {
        const rawPortada =
          b.portada ||
          b.first_image ||       // muy probable que venga así desde el backend
          b.cover ||
          b.cover_url ||
          b.imagen ||
          null;

        return {
          ...b,
          portada: this.normalizeMedia(rawPortada),
        };
      });
      this.books.set(normalizedBooks);

      // Historial (si luego quieres mostrar imágenes, aquí también podrías normalizar)
      this.history.set(history || []);
    } catch (e: any) {
      (await this.toast.create({
        message: e?.error?.detail || 'No se pudo cargar el perfil',
        duration: 1700,
        color: 'danger',
      })).present();
      this.router.navigateByUrl('/');
    } finally {
      this.loading.set(false);
    }
  }

  // Navegación desde otras páginas
  goUser(uid: number | null | undefined) {
    if (!uid) return;
    this.router.navigate(['/users', uid], { state: { from: this.router.url } });
  }

  goBack() {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      this.router.navigateByUrl(this.fallbackHref);
    }
  }

  onBookImgError(ev: Event) {
    const img = ev.target as HTMLImageElement | null;
    if (!img) return;
    if (img.src.includes(this.FALLBACK_BOOK)) return;
    img.src = this.FALLBACK_BOOK;
  }

  goRatings() {
    const u = this.prof();
    if (!u) return;

    this.router.navigate(['/users', u.id, 'ratings'], {
      queryParams: {
        name: u.nombre_completo || u.email,
      },
    });
  }

  goBook(id?: number | null) {
    if (id) this.router.navigate(['/books', id]);
  }
}
