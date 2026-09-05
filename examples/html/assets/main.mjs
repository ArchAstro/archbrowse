let count=0;
document.querySelector('#counter').addEventListener('click',()=> {
  count++; document.querySelector('#counter').textContent=`Count: ${count}`;
  document.querySelector('#count').textContent=String(count);
});
