import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule, HttpParams } from '@angular/common/http';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
    AlertController,
    IonicModule,
    ToastController,
} from '@ionic/angular';
import { environment } from 'src/environments/environment';

export interface AdminUserRow {
  id_usuario: number;
  email: string;
  nombres?: string;
  apellido_paterno?: string;
  apellido_materno?: string;
  nombre_usuario: string;
  activo: boolean;
  es_admin: boolean | number | string;   // por si viene 0/1 o "true"/"false"
  created_at?: string;
  total_libros?: number;
  total_intercambios?: number;
  rating_avg?: number | null;
  rating_count?: number;
}

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [IonicModule, CommonModule, HttpClientModule, FormsModule],
  templateUrl: './admin-users.page.html',
  styleUrls: ['./admin-users.page.scss'],
})
export class AdminUsersPage implements OnInit {
  private _loading = signal(true);
  private _rows = signal<AdminUserRow[]>([]);

  loading = computed(() => this._loading());
  rows = computed(() => this._rows());

  // filtros
  search = '';
  filtroActivo: 'todos' | 'activos' | 'inactivos' = 'todos';
  filtroAdmin: 'todos' | 'solo_admin' | 'no_admin' = 'todos';

  constructor(
    private http: HttpClient,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    this.load();
  }

  // ================== CARGAR LISTA ==================
  load(ev?: any) {
    this._loading.set(true);

    let params = new HttpParams();

    if (this.search.trim()) {
      params = params.set('search', this.search.trim());
    }
    if (this.filtroActivo === 'activos') {
      params = params.set('activo', 'true');
    } else if (this.filtroActivo === 'inactivos') {
      params = params.set('activo', 'false');
    }
    if (this.filtroAdmin === 'solo_admin') {
      params = params.set('es_admin', 'true');
    } else if (this.filtroAdmin === 'no_admin') {
      params = params.set('es_admin', 'false');
    }

    // OJO: apiUrl debe ser tipo "http://127.0.0.1:8000" (sin /api al final)
    const url = `${environment.apiUrl}/api/admin/users/`;

    this.http.get<AdminUserRow[]>(url, { params }).subscribe({
      next: (rows) => {
        let lista = rows || [];

        // Refuerzo en front por si backend no filtra del todo bien
        if (this.filtroAdmin === 'solo_admin') {
          lista = lista.filter((u) => this.isAdmin(u));
        } else if (this.filtroAdmin === 'no_admin') {
          lista = lista.filter((u) => !this.isAdmin(u));
        }

        this._rows.set(lista);
        this._loading.set(false);
        ev?.target?.complete();
      },
      error: (err) => {
        console.error('Error cargando usuarios admin', err);
        this._loading.set(false);
        ev?.target?.complete();
        this.showToast('No se pudo cargar la lista de usuarios.');
      },
    });
  }

  // ================== HELPERS VISUALES ==================
  nombreCompleto(u: AdminUserRow): string {
    const partes = [u.nombres, u.apellido_paterno, u.apellido_materno].filter(Boolean);
    return partes.join(' ') || u.nombre_usuario || u.email;
  }

  estadoBadgeColor(u: AdminUserRow): 'success' | 'medium' {
    return u.activo ? 'success' : 'medium';
  }

  estadoTexto(u: AdminUserRow): string {
    return u.activo ? 'Activo' : 'Inactivo';
  }

  // rating: solo mostramos si tiene al menos 1
  tieneRating(u: AdminUserRow): boolean {
    return (u.rating_count ?? 0) > 0;
  }

  ratingTexto(u: AdminUserRow): string {
    const avg = u.rating_avg ?? 0;
    return `${avg.toFixed(1)} ★ (${u.rating_count})`;
  }

  // ================== ADMIN HELPERS ==================
  isAdmin(u: AdminUserRow): boolean {
    const v: any = u.es_admin;
    return v === true || v === 1 || v === '1' || v === 'true';
  }

  // ================== FILTRO ADMIN ==================
  toggleFiltroAdmin(valor: 'solo_admin' | 'no_admin') {
    this.filtroAdmin = this.filtroAdmin === valor ? 'todos' : valor;
    this.load();
  }

  // ================== ACCIONES ==================
  async confirmarToggleActivo(u: AdminUserRow) {
    const nuevoEstado = !u.activo;

    const alert = await this.alertCtrl.create({
      header: nuevoEstado ? 'Activar usuario' : 'Desactivar usuario',
      message: nuevoEstado
        ? `¿Seguro que quieres ACTIVAR a <strong>${this.nombreCompleto(u)}</strong>?`
        : `¿Seguro que quieres DESACTIVAR a <strong>${this.nombreCompleto(
            u
          )}</strong>? El usuario no podrá iniciar sesión mientras esté inactivo.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: nuevoEstado ? 'Activar' : 'Desactivar',
          role: 'confirm',
        },
      ],
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'confirm') return;

    this.toggleActivo(u, nuevoEstado);
  }

  private toggleActivo(u: AdminUserRow, activo: boolean) {
    const url = `${environment.apiUrl}/api/admin/users/${u.id_usuario}/toggle/`;

    this.http
      .post<{ activo: boolean; message?: string }>(url, { activo })
      .subscribe({
        next: (res) => {
          const updated = this.rows().map((row) =>
            row.id_usuario === u.id_usuario ? { ...row, activo: res.activo } : row
          );
          this._rows.set(updated);
          this.showToast(
            res?.message ||
              (res.activo
                ? 'Usuario activado correctamente.'
                : 'Usuario desactivado correctamente.')
          );
        },
        error: (err) => {
          console.error('toggle-active error', err);
          this.showToast('No se pudo actualizar el estado del usuario.');
        },
      });
  }

  async confirmarEliminar(u: AdminUserRow) {
    const alert = await this.alertCtrl.create({
      header: 'Eliminar usuario',
      message: `¿Seguro que quieres ELIMINAR a <strong>${this.nombreCompleto(
        u
      )}</strong>? Esta acción no se puede deshacer.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive' },
      ],
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'destructive') return;

    this.eliminar(u);
  }

  private eliminar(u: AdminUserRow) {
    const url = `${environment.apiUrl}/api/admin/users/${u.id_usuario}/delete/`;

    this.http.delete<{ message?: string }>(url).subscribe({
      next: (res) => {
        const filtered = this.rows().filter(
          (row) => row.id_usuario !== u.id_usuario
        );
        this._rows.set(filtered);
        this.showToast(res?.message || 'Usuario eliminado correctamente.');
      },
      error: (err) => {
        console.error('delete user error', err);
        this.showToast('No se pudo eliminar el usuario.');
      },
    });
  }

  // ================== UI helpers ==================
  async showToast(message: string) {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2500,
      position: 'bottom',
    });
    await toast.present();
  }

  onSearchChange() {
    this.load();
  }

  onFilterChange() {
    this.load();
  }

  doRefresh(ev: any) {
    this.load(ev);
  }
}
