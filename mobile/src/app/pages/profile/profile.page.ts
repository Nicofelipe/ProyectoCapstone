// src/app/pages/my-books/profile.page.ts

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { IonicModule, ToastController } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { AuthService, MeUser } from 'src/app/core/services/auth.service';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, IonicModule, ReactiveFormsModule],
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
})
export class ProfilePage implements OnInit, OnDestroy {
  // Tabs
  tab = signal<'info' | 'history' | 'settings'>('info');

  // Estado
  user = signal<MeUser | null>(null);
  metrics = signal<{ libros: number; intercambios: number; calificacion: number | null }>({
    libros: 0,
    intercambios: 0,
    calificacion: null,
  });
  history = signal<{ id: number; titulo: string; estado: string; fecha?: string }[]>([]);
  editMode = signal(false);

  // Modal de avatar
  avatarModal = signal(false);

  // Form
  form = this.fb.nonNullable.group({
    nombres: ['', [Validators.required, Validators.maxLength(150)]],
    apellido_paterno: ['', [Validators.maxLength(100)]],
    apellido_materno: ['', [Validators.maxLength(100)]],
    telefono: ['', [Validators.maxLength(15)]],
    direccion: ['', [Validators.maxLength(255)]],
    numeracion: ['', [Validators.maxLength(10)]],
  });

  // Media
  mediaBase = environment.mediaBase || `${environment.apiUrl}/media/`;

  avatarUrl = computed(() => {
    const u = this.user();
    const rel = (u?.imagen_perfil || '').trim().replace(/^\/+/, '');
    return rel ? `${this.mediaBase}${rel}` : `${this.mediaBase}avatars/avatardefecto.jpg`;
  });

  fullName = computed(() => {
    const u = this.user(); if (!u) return '';
    const ap = (u.apellido_paterno || '').trim();
    const am = (u.apellido_materno || '').trim();
    return `${u.nombres}${ap ? ' ' + ap : ''}${am ? ' ' + am : ''}`.trim();
  });

  // Estrellas calculadas (con medias)
  stars = computed(() => {
    const rating = Number(this.metrics().calificacion ?? 0);
    const full = Math.floor(rating);
    const frac = rating - full;

    const hasExtraFull = frac >= 0.75 ? 1 : 0;
    const hasHalf = frac >= 0.25 && frac < 0.75 ? 1 : 0;

    const icons: string[] = [];
    for (let i = 0; i < Math.min(5, full + hasExtraFull); i++) icons.push('star');
    if (icons.length < 5 && hasHalf) icons.push('star-half');
    while (icons.length < 5) icons.push('star-outline');
    return icons;
  });

  private sub?: Subscription;

  constructor(
    private auth: AuthService,
    private router: Router,
    private toast: ToastController,
    private fb: FormBuilder,
  ) {
    // 🔴 Importante: Suscribirse a los cambios de sesión
    this.sub = this.auth.user$.subscribe((u) => {
      this.user.set(u);
      if (u) {
        this.preloadForm(u);
      } else {
        // si se cerró sesión, limpiamos estado visible
        this.metrics.set({ libros: 0, intercambios: 0, calificacion: null });
        this.history.set([]);
      }
    });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  private preloadForm(u: MeUser) {
    this.form.patchValue(
      {
        nombres: u.nombres ?? '',
        apellido_paterno: u.apellido_paterno ?? '',
        apellido_materno: u.apellido_materno ?? '',
        telefono: (u as any).telefono ?? '',
        direccion: (u as any).direccion ?? '',
        numeracion: (u as any).numeracion ?? '',
      },
      { emitEvent: false }
    );
  }

  async ngOnInit() {
    // En caso de entrar directo por URL
    await this.ionViewWillEnter();
  }

  // 🔁 Ionic llama este hook cada vez que la vista va a mostrarse
  async ionViewWillEnter() {
    await this.auth.restoreSession();
    const me = this.auth.user;
    if (!me) {
      this.router.navigateByUrl('/auth/login');
      return;
    }
    await this.loadSummary(me.id);
  }

  private async loadSummary(id: number) {
    try {
      const s = await this.auth.getUserSummary(id);
      const mapped: MeUser = {
        id: s.user.id_usuario,
        email: s.user.email,
        nombres: s.user.nombres,
        apellido_paterno: s.user.apellido_paterno,
        apellido_materno: s.user.apellido_materno,
        nombre_usuario: s.user.nombre_usuario,
        imagen_perfil: s.user.imagen_perfil || null,
        verificado: !!s.user.verificado,
        rut: s.user.rut || undefined,
        calificacion: s.metrics?.calificacion ?? undefined,
        telefono: s.user.telefono ?? undefined,
        direccion: s.user.direccion ?? undefined,
        numeracion: s.user.numeracion ?? undefined,
        direccion_completa: s.user.direccion_completa ?? undefined,
      };

      this.user.set(mapped);
      await this.auth.setUserLocal(mapped);

      this.metrics.set({
        libros: Number(s.metrics?.libros ?? 0),
        intercambios: Number(s.metrics?.intercambios ?? 0),
        calificacion: s.metrics?.calificacion ?? null,
      });
      this.history.set(Array.isArray(s.history) ? s.history : []);
      this.preloadForm(mapped);
    } catch (e) {
      console.error('GET /api/users/:id/summary falló', e);
      (await this.toast.create({ message: 'No se pudo cargar el perfil', color: 'danger', duration: 2000 })).present();
    }
  }

  // ====== UI ======
  setTab(t: 'info' | 'history' | 'settings') { this.tab.set(t); }
  toggleEdit() { this.editMode.update(v => !v); }

  // ==== Avatar ====
  openAvatarModal() { this.avatarModal.set(true); }
  closeAvatarModal() { this.avatarModal.set(false); }
  pickAvatar(input: HTMLInputElement) { input.click(); }

  async onAvatarSelected(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file || !this.user()) return;

    try {
      await this.auth.updateAvatar(this.user()!.id, file);
      // refresca summary por si el backend normaliza la ruta
      await this.loadSummary(this.user()!.id);
      (await this.toast.create({ message: 'Imagen actualizada', duration: 1500, color: 'success' })).present();
    } catch (e: any) {
      const detail = e?.error?.detail || e?.error?.message || 'No se pudo actualizar la imagen';
      (await this.toast.create({ message: detail, duration: 2200, color: 'danger' })).present();
    } finally {
      this.closeAvatarModal();
      (ev.target as HTMLInputElement).value = '';
    }
  }

  // ==== Guardar datos ====
  async save() {
    if (this.form.invalid || !this.user()) return;
    const id = this.user()!.id;
    const payload = this.form.getRawValue();

    try {
      await this.auth.updateMyProfile(id, payload);
      await this.loadSummary(id);
      (await this.toast.create({ message: 'Perfil actualizado', duration: 1600, color: 'success' })).present();
      this.editMode.set(false);
    } catch {
      (await this.toast.create({ message: 'No se pudo actualizar', duration: 1800, color: 'danger' })).present();
    }
  }

  async goChangePassword() { this.router.navigateByUrl('/auth/forgot'); }

  async doLogout() {
    await this.auth.logout();
    (await this.toast.create({ message: 'Sesión cerrada', duration: 1800 })).present();
    this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }
}
