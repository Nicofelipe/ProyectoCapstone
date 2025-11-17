// src/app/pages/my-books/my-books.page.ts
import { CommonModule, DatePipe, NgOptimizedImage } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { AuthService } from 'src/app/core/services/auth.service';
import { BooksService, MyBookCard } from 'src/app/core/services/books.service';
import { environment } from 'src/environments/environment';

type FilterKey = 'disponibles' | 'en-curso' | 'no-disponibles' | 'all';

@Component({
  selector: 'app-my-books',
  standalone: true,
  imports: [CommonModule, IonicModule, DatePipe, NgOptimizedImage, RouterModule],
  templateUrl: './my-books.page.html',
  styleUrls: ['./my-books.page.scss'],
})
export class MyBooksPage implements OnInit, OnDestroy {
  loading = signal(true);
  books = signal<MyBookCard[]>([]);
  filter = signal<FilterKey>('disponibles'); // arranca en Disponibles
  private sub?: Subscription;

  private toMs = (s?: string) => (s ? new Date(s).getTime() : 0);

  // Disponibles | En curso | No disponibles | Todos
  filteredBooks = computed(() => {
    const list = this.books();
    const byDateDesc = (a: MyBookCard, b: MyBookCard) =>
      this.toMs(b.fecha_subida) - this.toMs(a.fecha_subida);

    const isEnCurso = (b: MyBookCard) => this.stateTag(b).text === 'En curso';
    const filter = this.filter();

    if (filter === 'en-curso') {
      // Solo libros que están en negociación / pendientes salientes / aceptados
      return list.filter(isEnCurso).sort(byDateDesc);
    }

    if (filter === 'disponibles') {
      // Disponibles reales: disponibles y NO en curso
      return list
        .filter(b => b.disponible && !isEnCurso(b))
        .sort(byDateDesc);
    }

    if (filter === 'no-disponibles') {
      // No disponibles sin contar los que están "en curso"
      return list
        .filter(b => !b.disponible && !isEnCurso(b))
        .sort(byDateDesc);
    }

    // "Todos": primero En curso, luego disponibles normales, luego no disponibles
    const enCurso = list.filter(isEnCurso).sort(byDateDesc);
    const disp = list.filter(b => b.disponible && !isEnCurso(b)).sort(byDateDesc);
    const nodisp = list.filter(b => !b.disponible && !isEnCurso(b)).sort(byDateDesc);

    return [...enCurso, ...disp, ...nodisp];
  });

  constructor(
    private auth: AuthService,
    private booksSvc: BooksService,
    private router: Router,
  ) {}

  private mediaUrl(path: string): string {
    const baseFromEnv = (environment as any).mediaBase as string | undefined;
    if (baseFromEnv) {
      const clean = baseFromEnv.replace(/\/+$/, '');
      return `${clean}/${path.replace(/^\/+/, '')}`;
    }
    const api = environment.apiUrl.replace(/\/+$/, '');
    return `${api}/media/${path.replace(/^\/+/, '')}`;
  }

  emptyIllustrationUrl = this.mediaUrl('empty/writing-waiting.png');

  async ngOnInit() {
    await this.auth.restoreSession();
    const u = this.auth.user;
    if (!u) { this.router.navigateByUrl('/auth/login'); return; }
    await this.load(u.id);

    this.sub = this.booksSvc.myBooksEvents$.subscribe((ev) => {
      if (ev.type === 'cover-changed') {
        this.books.update(list =>
          list.map(b => b.id === ev.bookId ? ({ ...b, first_image: this.bust(ev.url) }) : b)
        );
      } else if (ev.type === 'deleted') {
        this.books.update(list => list.filter(b => b.id !== ev.bookId));
      } else if (ev.type === 'created') {
        this.books.update(list => [ev.book, ...list]);
      } else if (ev.type === 'requests-seen') {
        this.books.update(list =>
          list.map(b => b.id === ev.bookId ? ({ ...b, has_new_requests: false }) : b)
        );
      }
    });
  }

  ngOnDestroy() { this.sub?.unsubscribe(); }

  async ionViewWillEnter() {
    if (this.auth.user) {
      await this.load(this.auth.user.id);
    }
  }

  ionViewDidLeave() {
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  onFilterChange(ev: CustomEvent) {
    const v = (ev.detail as any)?.value as FilterKey;
    if (v) this.filter.set(v);
  }

  // === Estado del libro según intercambio / disponible / status_reason ===
  private stateTag(b: MyBookCard): { text: string; icon: string } {
    const estadoInter = ((b.estado_intercambio || b.intercambio_estado || '') + '').toLowerCase();
    const sr = (b.status_reason || '').toString().toUpperCase();
    const enNeg = b.en_negociacion === true;

    // 1) Intercambio completado (ya no se puede tocar)
    if (estadoInter === 'completado' || sr === 'COMPLETADO') {
      return { text: 'Intercambio completado', icon: 'trophy-outline' };
    }

    // 2) En curso: pendiente / aceptado / pendiente saliente
    if (enNeg || estadoInter === 'aceptado' || estadoInter === 'pendiente') {
      return { text: 'En curso', icon: 'swap-horizontal-outline' };
    }

    // 3) No disponible (pero no por intercambio activo)
    if (!b.disponible) {
      if (sr === 'OWNER') {
        return { text: 'Pausado por ti', icon: 'pause-circle-outline' };
      }
      if (sr === 'BAJA') {
        return { text: 'Retirado del catálogo', icon: 'ban-outline' };
      }
      return { text: 'No disponible', icon: 'close-circle-outline' };
    }

    // 4) Disponible normal
    return { text: 'Disponible', icon: 'checkmark-circle-outline' };
  }

  // Alias para usar en el template si lo necesitas
  noDispTag(b: MyBookCard): { text: string; icon: string } | null {
    // Si quieres que solo se use cuando NO está disponible, puedes limitarlo:
    // if (b.disponible) return null;
    return this.stateTag(b);
  }

  estadoIcon(b: MyBookCard): string {
    return this.stateTag(b).icon;
  }

  estadoVisual(b: MyBookCard): string {
    return this.stateTag(b).text;
  }

  private bust(url: string) {
    if (!url) return url;
    const hasQ = url.includes('?');
    return `${url}${hasQ ? '&' : '?'}v=${Date.now()}`;
  }

  async load(userId: number) {
    this.loading.set(true);
    try {
      const data = await this.booksSvc.getMine(userId).toPromise();
      this.books.set(data ?? []);
    } catch (e) {
      console.error('getMine failed', e);
      this.books.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  async doRefresh(ev: any) {
    const u = this.auth.user!;
    const data = await this.booksSvc.getMine(u.id).toPromise();
    this.books.set(data ?? []);
    ev.target.complete();
  }

  trackById = (_: number, b: MyBookCard) => b.id;

  goToPublish() {
    this.router.navigateByUrl('/add-book');
  }

  onEmptyImgError(ev: Event) {
    const img = ev.target as HTMLImageElement;
    const fallback = this.mediaUrl('books/librodefecto.png');
    if (img && img.src !== fallback) img.src = fallback;
  }

  onImgError(ev: Event) {
    const img = ev.target as HTMLImageElement;
    const fallback = this.mediaUrl('books/librodefecto.png');
    if (img && !img.src.includes('librodefecto.png')) img.src = fallback;
  }

  onItemClick(ev: Event) {
    (ev.currentTarget as HTMLElement | null)?.blur?.();
  }

  async open(b: MyBookCard) {
    const u = this.auth.user!;
    try {
      await this.booksSvc.markRequestsSeen(b.id, u.id).toPromise();
      this.booksSvc.emitRequestsSeen(b.id);
    } finally {
      this.router.navigate(['/my-books', b.id]);
    }
  }
}
