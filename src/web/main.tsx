import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.js';
import { ThemeProvider } from './theme/ThemeProvider.js';
import { PageHeaderProvider } from './components/PageHeaderContext.js';
import { I18nProvider } from './i18n/index.js';
import { registerEchartsThemes } from './theme/echarts.js';

registerEchartsThemes();

const qc = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 30_000 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <QueryClientProvider client={qc}>
          <BrowserRouter>
            <PageHeaderProvider>
              <App />
            </PageHeaderProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>
  </React.StrictMode>
);
