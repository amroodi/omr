/** localStorage key of the user's panel wallpaper (components/WallpaperPicker.tsx). */
export const WALL_KEY = 'omr_wall';

/** Re-applies the saved panel wallpaper before first paint (inlined in layout.tsx). */
export const WALL_BOOT_SCRIPT = `try{var w=localStorage.getItem('${WALL_KEY}');if(w&&w!=='default')document.documentElement.setAttribute('data-wall',w)}catch(e){}`;
