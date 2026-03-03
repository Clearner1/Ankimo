FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY .htpasswd /etc/nginx/.htpasswd
COPY index.html style.css app.js /usr/share/nginx/html/
EXPOSE 80
