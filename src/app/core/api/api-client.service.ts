import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';

@Injectable({
  providedIn: 'root',
})
export class ApiClientService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);

  private async createAuthHeaders(): Promise<HttpHeaders> {
    const token = await this.authService.getIdToken();
    let headers = new HttpHeaders({
      'Content-Type': 'application/json',
    });

    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }

    return headers;
  }

  async get<T>(url: string): Promise<T> {
    const headers = await this.createAuthHeaders();
    return firstValueFrom(this.http.get<T>(url, { headers }));
  }

  async post<T>(url: string, body: unknown): Promise<T> {
    const headers = await this.createAuthHeaders();
    return firstValueFrom(this.http.post<T>(url, body, { headers }));
  }

  async put<T>(url: string, body: unknown): Promise<T> {
    const headers = await this.createAuthHeaders();
    return firstValueFrom(this.http.put<T>(url, body, { headers }));
  }

  async delete<T>(url: string): Promise<T> {
    const headers = await this.createAuthHeaders();
    return firstValueFrom(this.http.delete<T>(url, { headers }));
  }
}
