// src/app/pages/user-profile/user-profile.page.ts
import { CommonModule, Location } from '@angular/common';
import { Component, computed, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule, ToastController } from '@ionic/angular';
import { AuthService } from 'src/app/core/services/auth.service';
import { BooksService, MyBookCard } from 'src/app/core/services/books.service';
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
    private booksSvc: BooksService,          // 👈 NUEVO
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
      // 👇 OJO: usamos BooksService.getMine(id) como en "Mis libros"
      const [profile, rawBooks, history] = await Promise.all([
        this.auth.getUserProfile(id),
        this.booksSvc.getMine(id).toPromise(),          // <--- mismo endpoint que MyBooksPage
        this.auth.getUserIntercambios(id),
      ]);

      // 🧑‍🎨 Normalizar avatar (avatar_url o imagen_perfil)
      const avatarRaw = profile?.avatar_url ?? profile?.imagen_perfil ?? null;
      const avatarNorm = this.normalizeMedia(avatarRaw);
      this.prof.set({
        ...profile,
        avatar_url: avatarNorm ?? avatarRaw ?? null,
      });

      // 📚 Normalizar portadas de libros reutilizando first_image
      const normalizedBooks: PublicBook[] = (rawBooks || []).map((b: MyBookCard) => {
        // first_image viene casi siempre absoluta desde backend
        const portadaNorm = this.normalizeMedia(b.first_image ?? null) || b.first_image || null;
        return {
          id: b.id,
          titulo: b.titulo,
          autor: b.autor,
          fecha_subida: b.fecha_subida ?? null,
          portada: portadaNorm,
        };
      });
      this.books.set(normalizedBooks);

      // Historial
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
