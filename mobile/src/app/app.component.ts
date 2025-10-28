import {
  AfterViewInit, ChangeDetectorRef, Component, ElementRef,
  OnDestroy, OnInit, ViewChild
} from '@angular/core';
import { Router } from '@angular/router';
import { MenuController } from '@ionic/angular';
import { environment } from '../environments/environment';
import { AuthService, User } from './core/services/auth.service';

interface MenuItem { icon: string; name: string; redirectTo: string; }

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit, AfterViewInit, OnDestroy {
  user: User | null = null;

  readonly mediaBase =
    (environment as any).mediaBase ??
    ((environment as any).apiUrl
      ? `${(environment as any).apiUrl.replace(/\/+$/, '')}/media/`
      : '/media/');

  items: MenuItem[] = [
    { name: 'Inicio', redirectTo: '/home', icon: 'home-outline' },
    { name: 'Libros', redirectTo: '/books', icon: 'book-outline' },
    { name: 'Login', redirectTo: '/auth/login', icon: 'log-in' },
    { name: 'Registro', redirectTo: '/auth/register', icon: 'person' },
    { name: 'Mis libros', redirectTo: '/my-books', icon: 'library-outline' },
    { name: 'Solicitudes', redirectTo: '/requests',  icon: 'swap-horizontal-outline' },
  ];

  get visibleItems(): MenuItem[] {
    if (this.user) {
      // logueado: ocultar login/registro
      return this.items.filter(i => !['/auth/login', '/auth/register'].includes(i.redirectTo));
    }
    // invitado: ocultar "Mis libros"
     return this.items.filter(i => !['/my-books', '/requests'].includes(i.redirectTo));
    
  }

  // 👇 HAZLO OPCIONAL y con { static: false }
  @ViewChild('footerSentinel', { static: false }) footerSentinel?: ElementRef<HTMLDivElement>;
  footerVisible = false;
  private io?: IntersectionObserver;

  constructor(
    private cdr: ChangeDetectorRef,
    private auth: AuthService,
    private router: Router,
    private menu: MenuController,
  ) {
    document.body.classList.remove('dark');
  }

  async ngOnInit() {
    await this.auth.restoreSession();
    this.auth.user$.subscribe(u => { this.user = u; this.cdr.markForCheck(); });
  }

  ngAfterViewInit() {
    this.io = new IntersectionObserver(
      ([entry]) => {
        this.footerVisible = !!entry?.isIntersecting;
        this.cdr.markForCheck();
      },
      { root: null, threshold: 0.75, rootMargin: '0px 0px -180px' }
    );

    const el = this.footerSentinel?.nativeElement;
    if (el) {
      this.io.observe(el);
    } else {
      console.warn('footerSentinel no encontrado; agrega #footerSentinel en el template.');
    }

    setTimeout(() => {
      const noScroll = document.documentElement.scrollHeight <= window.innerHeight + 8;
      if (noScroll) { this.footerVisible = false; this.cdr.markForCheck(); }
    });
  }

  ngOnDestroy() { this.io?.disconnect(); }

  /** Avatar/encabezado -> Perfil */
  async goProfile() {
    if (!this.user) { this.router.navigateByUrl('/auth/login'); return; }
    await this.menu.close();
    this.router.navigateByUrl('/profile');
  }

  async logout() {
    await this.auth.logout();
    await this.menu.close();
    this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }

  avatarUrl(u: User | null): string {
    if (!u?.imagen_perfil) return `${this.mediaBase}avatars/avatardefecto.jpg`;
    if (/^https?:\/\//i.test(u.imagen_perfil)) return u.imagen_perfil;
    return `${this.mediaBase}${u.imagen_perfil.replace(/^\/+/, '')}`;
  }

  displayName(u: User | null): string {
    if (!u) return '';
    const ap = u.apellido_paterno ? ` ${u.apellido_paterno}` : '';
    return `${u.nombres}${ap}`;
  }

  onAddBook() {
    if (!this.user) { this.router.navigateByUrl('/auth/login'); return; }
    this.router.navigateByUrl('/add-book');
  }
}
