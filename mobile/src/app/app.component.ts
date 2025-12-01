import {
  AfterViewInit, ChangeDetectorRef, Component, ElementRef,
  OnDestroy, OnInit, ViewChild
} from '@angular/core';
import { Router } from '@angular/router';
import { MenuController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';
import { AuthService, User } from './core/services/auth.service';
import { IntercambiosService } from './core/services/intercambios.service';




interface MenuItem { icon: string; name: string; redirectTo: string; adminOnly?: boolean }

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit, AfterViewInit, OnDestroy {
  user: User | null = null;

  hasPendingRequests = false;


  private pendingInterval: any;


  readonly mediaBase =
    (environment as any).mediaBase ??
    ((environment as any).apiUrl
      ? `${(environment as any).apiUrl.replace(/\/+$/, '')}/media/`
      : '/media/');




      get isAdmin(): boolean {
  return !!this.user?.es_admin;
}

  items: MenuItem[] = [
    { name: 'Inicio', redirectTo: '/home', icon: 'home-outline' },
    { name: 'Mi Perfil', redirectTo: '/profile', icon: 'person-circle-outline' },
    { name: 'Mis libros', redirectTo: '/my-books', icon: 'library-outline' },
    { name: 'Catálogo de Libros', redirectTo: '/catalog', icon: 'book-outline' },
    { name: 'Favoritos', redirectTo: '/favorites', icon: 'heart-outline' },
    { name: 'Donar', redirectTo: '/donar', icon: 'gift-outline' },
    { name: 'Login', redirectTo: '/auth/login', icon: 'log-in' },
    { name: 'Registro', redirectTo: '/auth/register', icon: 'person' },
    { name: 'Solicitudes', redirectTo: '/requests', icon: 'swap-horizontal-outline' },
    { name: 'Chats', redirectTo: '/chats', icon: 'chatbubbles-outline' },
    { name: 'Ubicaciones', redirectTo: '/cambiotecas', icon: 'map-outline' },
    { name: 'Sobre nosotros', redirectTo: '/about', icon: 'information-circle-outline' },

    // 🔥 Zona admin (solo se verá si user.es_admin === true)
    { name: 'Panel Admin', redirectTo: '/admin/dashboard', icon: 'stats-chart-outline', adminOnly: true },
    { name: 'Usuarios', redirectTo: '/admin/users', icon: 'people-outline', adminOnly: true },
    { name: 'Reportes', redirectTo: '/admin/reports', icon: 'flag-outline', adminOnly: true },
  ];

  get visibleItems(): MenuItem[] {
    // 🛡️ MODO ADMIN: solo navegación de administración + cosas neutrales
    if (this.user?.es_admin) {
      const allowedForAdmin = new Set<string>([
        '/home',
        '/catalog',
        '/admin/dashboard',
        '/admin/users',
        '/admin/reports',
      ]);

      return this.items.filter(it => allowedForAdmin.has(it.redirectTo));
    }

    // 👤 MODO USUARIO NORMAL (lo que ya tenías, con adminOnly oculto)
    return this.items.filter(it => {
      // 1) Items SOLO para admin
      if (it.adminOnly) {
        return false; // usuario normal no los ve
      }

      // 2) Si hay usuario logueado
      if (this.user) {
        // Ocultar login/registro si ya inició sesión
        if (['/auth/login', '/auth/register'].includes(it.redirectTo)) return false;
        return true;
      }

      // 3) Invitado: ocultar secciones que requieren sesión
      if (['/profile', '/favorites', '/my-books', '/requests', '/chats'].includes(it.redirectTo)) {
        return false;
      }

      return true;
    });
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
    private intercambios: IntercambiosService,
  ) {
    document.body.classList.remove('dark');
  }

  async ngOnInit() {
    await this.auth.restoreSession();

    // 🔐 Usuario logueado / no logueado
    this.auth.user$.subscribe(u => {
      this.user = u;
      this.cdr.markForCheck();

      if (u) {
        // 🚨 Pídele al backend el resumen (has_new)
        this.intercambios.refreshGlobalRequestsBadge(u.id);
      } else {
        this.hasPendingRequests = false;
      }
    });

    // 🔴 Suscribirse al observable global del badge
    this.intercambios.hasNewGlobalRequests$.subscribe(flag => {
      this.hasPendingRequests = flag;
      this.cdr.markForCheck();
    });
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


  private normalizeEstado(s: string) {
    return (s ?? '')
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z]/g, '')
      .trim();
  }

  private canonicalEstado(row: any): string {
    const raw = row?.estado ?? '';
    const n = this.normalizeEstado(raw);

    if (n.includes('complet') || n.includes('finaliz') || n.includes('cerrad') || !!row?.fecha_completado)
      return 'completada';
    if (n.includes('pend')) return 'pendiente';
    if (n.includes('acept')) return 'aceptada';
    if (n.includes('rechaz') || n.includes('declin')) return 'rechazada';
    if (n.includes('cancel')) return 'cancelada';
    return n || 'otro';
  }


  private async refreshPendingFlag() {
    if (!this.user) {
      this.hasPendingRequests = false;
      this.cdr.markForCheck();
      return;
    }

    try {
      const raw = await firstValueFrom(
        this.intercambios.listarRecibidas(this.user.id)
      ) as any[];

      this.hasPendingRequests =
        Array.isArray(raw) &&
        raw.some(r => this.canonicalEstado(r) === 'pendiente');

    } catch {
      this.hasPendingRequests = false;
    } finally {
      this.cdr.markForCheck();
    }
  }

  ngOnDestroy() {
    this.io?.disconnect();
  }

  /** Avatar/encabezado -> Perfil */
  async goProfile() {
    if (!this.user) { this.router.navigateByUrl('/auth/login'); return; }
    await this.menu.close();
    this.router.navigateByUrl('/profile');
  }

  async logout() {
    await this.auth.logout();      // 👈 limpia token/user en Preferences y cache
    await this.menu.close();
    this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }

  async logoutAll() {
    await this.auth.logoutAll();                // 👉 pega al backend y luego limpia local
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
