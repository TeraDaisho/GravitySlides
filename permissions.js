document.getElementById('authBtn').addEventListener('click', async () => {
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        document.getElementById('successMsg').style.display = 'block';
        document.getElementById('authBtn').style.display = 'none';
    } catch (err) {
        alert("Permission denied or error: " + err.message);
    }
});
