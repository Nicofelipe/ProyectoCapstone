// src/app/pages/auth/reset/reset.page.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonInput, IonItem,
  IonList, IonMenuButton, IonNote, IonTitle, IonToolbar
} from '@ionic/angular/standalone';
import { AuthService } from 'src/app/core/services/auth.service';

function matchPasswords(ctrl: AbstractControl) {
  const p = ctrl.get('password')?.value;
  const c = ctrl.get('confirm')?.value;
  return p && c && p === c ? null : { mismatch: true };
}
const STRONG_PWD_RX = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^\w\s]).{8,}$/;

@Component({
  selector: 'app-reset',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
    IonContent, IonItem, IonInput, IonButton, IonList, IonNote
  ],
  templateUrl: './reset.page.html',
  styleUrls: ['./reset.page.scss']
})
export class ResetPage implements OnInit {
  token = '';
  busy = false;

  form = this.fb.group({
    password: ['', [Validators.required, Validators.pattern(STRONG_PWD_RX)]],
    confirm: ['', [Validators.required]]
  }, { validators: matchPasswords });

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private auth: AuthService,
    private toast: ToastController
  ) { }

  ngOnInit() {
    this.token = this.route.snapshot.paramMap.get('token') || '';
  }


  async submit() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    if (!this.token) {
      (await this.toast.create({
        message: 'Token inválido o ausente. Vuelve a solicitar el enlace.',
        duration: 2500, color: 'danger'
      })).present();
      return;
    }

    this.busy = true;
    try {
      const pwd = this.form.value.password!;
      const pwd2 = this.form.value.confirm!;
      await this.auth.resetPassword(this.token, pwd, pwd2);

      (await this.toast.create({
        message: 'Contraseña actualizada. Ya puedes iniciar sesión.',
        duration: 2500, color: 'success'
      })).present();
      this.router.navigateByUrl('/auth/login', { replaceUrl: true });
    } catch (e: any) {
      (await this.toast.create({
        message: e?.error ? (typeof e.error === 'string' ? e.error : JSON.stringify(e.error)) : 'No se pudo actualizar la contraseña.',
        duration: 2800, color: 'danger'
      })).present();
    } finally {
      this.busy = false;
    }
  }

  get f() { return this.form.controls; }
}
