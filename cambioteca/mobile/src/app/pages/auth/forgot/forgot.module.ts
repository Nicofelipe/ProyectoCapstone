import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { RouterModule, Routes } from '@angular/router';
import { ForgotPageRoutingModule } from './forgot-routing.module';
import { ForgotPage } from './forgot.page';
const routes: Routes = [
  {
    path: '',
    component: ForgotPage
  }
];

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    ForgotPageRoutingModule,
    RouterModule.forChild(routes), ForgotPage
    
  ],
  declarations: [ForgotPage]
})
export class ForgotPageModule {}
