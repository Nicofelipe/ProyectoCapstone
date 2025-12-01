// src/app/pages/donar/donar.page.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertController, IonicModule, LoadingController, ToastController } from '@ionic/angular';
import { AuthService } from 'src/app/core/services/auth.service';
import { DonacionesService } from 'src/app/core/services/donaciones.service';

@Component({
  standalone: true,
  selector: 'app-donar',
  templateUrl: './donar.page.html',
  styleUrls: ['./donar.page.scss'],
  imports: [IonicModule, CommonModule, FormsModule],
})
export class DonarPage implements OnInit {
  monto = 2000; // Monto por defecto
  loading = false;
  montosPopulares = [1000, 2000, 5000, 10000];

  constructor(
    private donaciones: DonacionesService,
    private auth: AuthService,
    private toastCtrl: ToastController,
    private loadingCtrl: LoadingController,
    private alertCtrl: AlertController
  ) {}

  ngOnInit() {
    console.log('Página de donaciones inicializada');
  }

  /**
   * Selecciona un monto predefinido
   */
  seleccionarMonto(valor: number) {
    this.monto = valor;
    
    // Feedback háptico si está disponible (móviles)
    if ('vibrate' in navigator) {
      navigator.vibrate(10);
    }

    // Feedback visual adicional (opcional)
    console.log(`Monto seleccionado: $${valor}`);
  }

  /**
   * Valida el monto ingresado
   */
  validarMonto(): boolean {
    if (!this.monto || this.monto < 500) {
      return false;
    }
    return true;
  }

  /**
   * Procesa el pago
   */
  async pagar() {
    // Validar monto
    if (!this.validarMonto()) {
      await this.showToast('⚠️ El monto mínimo es $500', 'warning');
      return;
    }

    // Validar que no esté ya procesando
    if (this.loading) {
      return;
    }

    // Confirmar donación
    const confirmar = await this.confirmarDonacion();
    if (!confirmar) {
      return;
    }

    // Mostrar loading
    const loader = await this.loadingCtrl.create({
      message: 'Preparando tu donación...',
      spinner: 'crescent',
      cssClass: 'custom-loading'
    });
    await loader.present();

    this.loading = true;

    try {
      const user = this.auth.user;
      const userId = user?.id;

      this.donaciones.crearDonacion(this.monto, userId || undefined).subscribe({
        next: async (res) => {
          await loader.dismiss();
          this.loading = false;

          if (res?.redirect_url) {
            await this.showToast('✅ Redirigiendo a Webpay...', 'success');
            
            // Pequeño delay para que el usuario vea el mensaje
            setTimeout(() => {
              window.location.href = res.redirect_url;
            }, 800);
          } else {
            await this.showToast('❌ No se recibió la URL de pago.', 'danger');
          }
        },
        error: async (err) => {
          console.error('Error creando donación:', err);
          await loader.dismiss();
          this.loading = false;

          const errorMsg = this.getErrorMessage(err);
          await this.showErrorAlert(errorMsg);
        },
      });
    } catch (error) {
      console.error('Error inesperado:', error);
      await loader.dismiss();
      this.loading = false;
      await this.showErrorAlert('Ocurrió un error inesperado. Por favor intenta nuevamente.');
    }
  }

  /**
   * Obtiene el mensaje de error apropiado
   */
  private getErrorMessage(err: any): string {
    if (err?.error?.message) {
      return err.error.message;
    }
    if (err?.message) {
      return err.message;
    }
    return 'No se pudo iniciar el pago. Por favor intenta nuevamente.';
  }

  /**
   * Confirma la donación con el usuario
   */
  private async confirmarDonacion(): Promise<boolean> {
    const alert = await this.alertCtrl.create({
      header: '💛 Confirmar Donación',
      message: `
        <div style="text-align: center; padding: 12px 0;">
          <p style="font-size: 16px; margin-bottom: 8px;">¿Deseas donar</p>
          <p style="font-size: 28px; font-weight: bold; color: #FF6B35; margin: 8px 0;">
            $${this.monto.toLocaleString('es-CL')}
          </p>
          <p style="font-size: 14px; color: #666; margin-top: 8px;">a Cambioteca?</p>
        </div>
      `,
      cssClass: 'custom-alert',
      buttons: [
        {
          text: 'Cancelar',
          role: 'cancel',
          cssClass: 'alert-button-cancel',
          handler: () => {
            console.log('Donación cancelada por el usuario');
          }
        },
        {
          text: '✓ Sí, donar',
          role: 'confirm',
          cssClass: 'alert-button-confirm',
          handler: () => {
            console.log('Donación confirmada');
          }
        },
      ],
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'confirm';
  }

  /**
   * Muestra un alert de error
   */
  private async showErrorAlert(message: string) {
    const alert = await this.alertCtrl.create({
      header: '❌ Error',
      message,
      buttons: [
        {
          text: 'Entendido',
          role: 'cancel'
        },
        {
          text: 'Reintentar',
          handler: () => {
            // Opcional: reintentar automáticamente
            this.pagar();
          }
        }
      ],
      cssClass: 'custom-alert-error'
    });
    await alert.present();
  }

  /**
   * Muestra un toast mensaje
   */
  private async showToast(
    message: string, 
    color: 'success' | 'warning' | 'danger' | 'primary' = 'primary'
  ) {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2800,
      position: 'bottom',
      color,
      cssClass: 'custom-toast',
      buttons: [
        {
          icon: 'close',
          role: 'cancel'
        }
      ]
    });
    await toast.present();
  }

  /**
   * Formatea el monto para mostrar
   */
  formatearMonto(monto: number): string {
    return `$${monto.toLocaleString('es-CL')}`;
  }

  /**
   * Maneja el cambio en el input de monto
   */
  onMontoChange() {
    // Asegurar que el monto sea un número válido
    if (this.monto && this.monto < 0) {
      this.monto = 0;
    }
    
    // Redondear a múltiplos de 100 (opcional)
    if (this.monto && this.monto > 0) {
      this.monto = Math.round(this.monto / 100) * 100;
    }
  }

  /**
   * Limpia y destruye recursos al salir
   */
  ngOnDestroy() {
    // Limpiar cualquier suscripción si fuera necesario
    this.loading = false;
  }
}