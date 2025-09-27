import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AddBookPage } from './add-book.page';

const routes: Routes = [{ path: '', component: AddBookPage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AddBookPageRoutingModule {}
