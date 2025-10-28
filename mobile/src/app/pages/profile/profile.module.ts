import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { ProfilePage } from './profile.page';

@NgModule({
  declarations: [ProfilePage],   // 👈 ahora sí
  imports: [
    CommonModule,
    IonicModule,
    RouterModule.forChild([{ path: '', component: ProfilePage }]),
  ],
})
export class ProfilePageModule {}
