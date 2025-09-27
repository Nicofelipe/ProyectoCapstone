import { CommonModule, DatePipe, NgOptimizedImage } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { AuthService } from 'src/app/core/services/auth.service';
import { BooksService, MyBookCard } from 'src/app/core/services/books.service';

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
  private sub?: Subscription;

  constructor(
    private auth: AuthService,
    private booksSvc: BooksService,
    private router: Router,
  ) { }

  async ngOnInit() {
    await this.auth.restoreSession();
    const u = this.auth.user;
    if (!u) { this.router.navigateByUrl('/auth/login'); return; }
    await this.load(u.id);

    // 🔔 Reacciones en vivo: portada cambiada / libro borrado / creado
    this.sub = this.booksSvc.myBooksEvents$.subscribe((ev) => {
      if (ev.type === 'cover-changed') {
        this.books.update(list =>
          list.map(b => b.id === ev.bookId ? ({ ...b, first_image: this.bust(ev.url) }) : b)
        );
      } else if (ev.type === 'deleted') {
        this.books.update(list => list.filter(b => b.id !== ev.bookId));
      } else if (ev.type === 'created') {
        this.books.update(list => [ev.book, ...list]);
      }
    });
  }

  onItemClick(ev: Event) {
    const el = ev.currentTarget as HTMLElement | null;
    el?.blur();
  }

  ngOnDestroy() { this.sub?.unsubscribe(); }

  // Al volver a esta vista, refresca (por si se hicieron cambios en detail)
  async ionViewWillEnter() {
    const u = this.auth.user;
    if (u) await this.load(u.id);
  }

  ionViewDidLeave() {
    // Evita warning de aria-hidden con foco retenido
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  private bust(url: string) {
    if (!url) return url;
    const hasQ = url.includes('?');
    return `${url}${hasQ ? '&' : '?'}v=${Date.now()}`;
    // cache-busting para ver la nueva portada al instante
  }

  async load(userId: number) {
    this.loading.set(true);
    try {
      const data = await this.booksSvc.getMine(userId).toPromise();
      this.books.set(data ?? []);
    } catch (e) {
      console.error('getMine failed', e);
      this.books.set([]);
      // TODO: mostrar toast si quieres
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

  onImgError(ev: Event) {
    const img = ev.target as HTMLImageElement;
    if (img && !img.src.includes('/media/books/librodefecto.png')) {
      img.src = '/media/books/librodefecto.png';
    }
  }
}
