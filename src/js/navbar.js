 // Nav-bar functionality when screen is less than 600px
 const toggleButton = document.getElementsByClassName('toggle-button')[0];
 const navbarLinks = document.getElementsByClassName('navbar-links')[0];

 toggleButton.addEventListener('click', () =>{
   navbarLinks.classList.toggle('active');
 })
