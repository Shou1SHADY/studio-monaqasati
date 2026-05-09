import fs from 'fs';
import path from 'path';

function findTdzErrors(dir) {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
        const fullPath = path.join(dir, file.name);
        if (file.isDirectory()) {
            findTdzErrors(fullPath);
        } else if (file.name.endsWith('.tsx') || file.name.endsWith('.ts')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            const lines = content.split('\n');
            
            let profileDeclaredLine = -1;
            let userDataDeclaredLine = -1;
            
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('const { data: profile }') || lines[i].includes('let { data: profile }')) {
                    profileDeclaredLine = i;
                }
                if (lines[i].includes('const { data: userData }') || lines[i].includes('let { data: userData }')) {
                    userDataDeclaredLine = i;
                }
            }
            
            if (profileDeclaredLine !== -1) {
                for (let i = 0; i < profileDeclaredLine; i++) {
                    if (lines[i].includes('profile?.') || lines[i].includes('profile.')) {
                        console.log(`Potential TDZ error in ${fullPath} at line ${i+1}: 'profile' used before declaration at line ${profileDeclaredLine+1}`);
                    }
                }
            }
            
            if (userDataDeclaredLine !== -1) {
                for (let i = 0; i < userDataDeclaredLine; i++) {
                    if (lines[i].includes('userData?.') || lines[i].includes('userData.')) {
                        console.log(`Potential TDZ error in ${fullPath} at line ${i+1}: 'userData' used before declaration at line ${userDataDeclaredLine+1}`);
                    }
                }
            }
        }
    }
}

findTdzErrors('c:/Users/HP/Downloads/studio-monaqasati/src/app');
