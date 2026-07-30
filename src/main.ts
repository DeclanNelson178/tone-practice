import './ui/styles.css';
import { mount } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('#app not found');

mount(root);
