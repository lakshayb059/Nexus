import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api',
});

// Add a request interceptor to include the auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('crm_token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Add a response interceptor to handle auth errors globally and auto-retry 502 errors due to Render cold starts
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;
    
    // Check if the error is a 502 Bad Gateway and we haven't reached max retries yet
    if (response && response.status === 502) {
      config.__retryCount = config.__retryCount || 0;
      const maxRetries = 3;
      const retryDelay = 4000; // 4 seconds delay between retries
      
      if (config.__retryCount < maxRetries) {
        config.__retryCount += 1;
        console.warn(`⚠️ [Render Cold Start (502)] detected. Retrying request (${config.__retryCount}/${maxRetries}) in ${retryDelay / 1000}s...`, config.url);
        
        // Wait for the delay duration
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        
        // Retry the request with the same configuration
        return api(config);
      }
    }

    if (response && response.status === 401) {
      if (config && !config.url.includes('/auth/login')) {
        alert('Session expired. Please relogin to continue.');
        localStorage.removeItem('crm_token');
        localStorage.removeItem('crm_user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
