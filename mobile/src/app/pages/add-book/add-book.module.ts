import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { AddBookPageRoutingModule } from './add-book-routing.module';
import { AddBookPage } from './add-book.page';

@NgModule({
  declarations: [],                 // 👈 standalone => no declarar
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonicModule,
    AddBookPageRoutingModule,
    AddBookPage,                    // 👈 importar el standalone
  ],
})
export class AddBookPageModule {}
